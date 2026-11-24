// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
mod appimage_wayland;

fn main() {
    #[cfg(target_os = "linux")]
    appimage_wayland::preload_host_wayland_client();

    let _ = fix_path_env::fix_all_vars();

    #[cfg(target_os = "macos")]
    fix_macos_temp_dir();

    #[cfg(target_os = "linux")]
    apply_linux_workarounds();

    #[cfg(target_os = "linux")]
    set_audio_stream_identity();

    app_lib::run();
}

#[cfg(target_os = "linux")]
fn set_audio_stream_identity() {
    glib::set_application_name("Nuclear");

    if std::env::var("PULSE_PROP").is_err() {
        let icon =
            std::env::var("FLATPAK_ID").unwrap_or_else(|_| "nuclear-music-player".to_string());
        unsafe {
            std::env::set_var("PULSE_PROP", format!("application.icon_name={icon}"));
        }
    }
}

// macOS GUI apps don't inherit TMPDIR from the login session. It's set per-user
// by launchd, not by the shell, so fix_path_env can't pick it up. confstr with
// _CS_DARWIN_USER_TEMP_DIR returns the correct value.
#[cfg(target_os = "macos")]
fn fix_macos_temp_dir() {
    if std::env::var("TMPDIR").is_ok() {
        return;
    }
    let mut buf = [0u8; 4096];
    let len = unsafe {
        libc::confstr(
            libc::_CS_DARWIN_USER_TEMP_DIR,
            buf.as_mut_ptr() as *mut _,
            buf.len(),
        )
    };
    if len > 0 && len <= buf.len() {
        if let Ok(path) = std::str::from_utf8(&buf[..len - 1]) {
            unsafe { std::env::set_var("TMPDIR", path) };
        }
    }
}

#[cfg(target_os = "linux")]
fn apply_linux_workarounds() {
    // Fix for WebKitGTK GPU rendering failures on various Linux systems including
    // Steam Deck, NVIDIA GPUs, and W**land compositors.
    //
    // WEBKIT_DISABLE_DMABUF_RENDERER: Fixes "Could not create default EGL display:
    // EGL_BAD_PARAMETER" and blank screens on NVIDIA.
    // See: https://github.com/tauri-apps/tauri/issues/9394
    //
    // WEBKIT_DISABLE_COMPOSITING_MODE: Fixes "Failed to get GBM device" errors
    // and crashes on resize with NVIDIA/Steam Deck.
    // See: https://github.com/tauri-apps/tauri/issues/11994
    if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
        unsafe {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
    if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err() {
        unsafe {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }

    // Route WebKitGTK's audio through pulsesink so PULSE_LATENCY_MSEC applies.
    if std::env::var("GST_PLUGIN_FEATURE_RANK").is_err() {
        unsafe {
            std::env::set_var("GST_PLUGIN_FEATURE_RANK", "pipewiresink:NONE");
        }
    }

    // Request high-latency audio streams. Web Audio's low-latency request
    // forces the PipeWire quantum down below what Bluetooth A2DP can service,
    // killing playback: https://github.com/nukeop/nuclear/discussions/1980
    if std::env::var("PULSE_LATENCY_MSEC").is_err() {
        unsafe {
            std::env::set_var("PULSE_LATENCY_MSEC", "60");
        }
    }
    if std::env::var("PIPEWIRE_LATENCY").is_err() {
        unsafe {
            std::env::set_var("PIPEWIRE_LATENCY", "1024/48000");
        }
    }

    apply_appimage_fontconfig_workaround();
}

#[cfg(target_os = "linux")]
fn apply_appimage_fontconfig_workaround() {
    // Ubuntu 22.04's bundled WebKitGTK/Skia inside the AppImage aborts with SIGABRT
    // in colrv1_configure_skpaint when rendering COLRv1 color emoji fonts shipped on
    // newer distros (Fedora 43/44, Bazzite, Nobara, etc.). Reject COLRv1 fonts via a
    // Fontconfig wrapper so Fontconfig falls back to bitmap/CBDT emoji fonts (e.g. Twemoji).
    if std::env::var_os("APPIMAGE").is_none() || std::env::var_os("FONTCONFIG_FILE").is_some() {
        return;
    }

    let base_dir = std::env::var_os("XDG_RUNTIME_DIR")
        .filter(|dir| !dir.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);

    let uid = unsafe { libc::geteuid() };
    let conf_path = base_dir.join(format!("nuclear-appimage-fontconfig-{uid}.conf"));

    const FONTCONFIG_XML: &str = r#"<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <selectfont>
    <rejectfont>
      <glob>*COLRv1*</glob>
      <glob>*colrv1*</glob>
    </rejectfont>
  </selectfont>
</fontconfig>
"#;

    if std::fs::write(&conf_path, FONTCONFIG_XML).is_ok() {
        unsafe {
            std::env::set_var("FONTCONFIG_FILE", &conf_path);
        }
    }
}

pub mod bridge;
pub mod commands;
pub mod db;
pub mod discord;
pub mod history;
pub mod http;
pub mod http_api;
pub mod logging;
pub mod mcp;
pub mod mpd;
pub mod net;
pub mod p2p_sync;
pub mod pagination;
pub mod profile;
mod setup;
pub mod stream_server;
pub mod ytdlp;
pub mod ytdlp_setup;
pub mod ytdlp_verify;

// Maximizes the window when running as a non-steam app in steam
#[cfg(target_os = "linux")]
fn maximize_for_gamescope(app: &tauri::App) {
    use tauri::Manager;

    let is_gamescope = std::env::var("GAMESCOPE_WAYLAND_DISPLAY").is_ok()
        || std::env::var("SteamDeck").map_or(false, |v| v == "1");

    if is_gamescope {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.maximize();
        }
    }
}

fn typescript_export_config() -> specta_typescript::Typescript {
    specta_typescript::Typescript::default().header("/* eslint-disable */")
}

fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
        commands::is_flatpak,
        commands::copy_dir_recursive,
        commands::extract_zip,
        commands::download_file,
        commands::self_update_appimage,
        commands::relaunch_appimage,
        commands::get_runtime_platform,
        commands::self_update_windows,
        commands::sha256_file,
        http::http_fetch,
        ytdlp::ytdlp_search,
        ytdlp::ytdlp_get_stream,
        ytdlp::ytdlp_get_playlist,
        logging::get_startup_logs,
        mcp::mcp_start,
        mcp::mcp_stop,
        http_api::http_api_start,
        http_api::http_api_stop,
        mpd::mpd_start,
        mpd::mpd_stop,
        stream_server::stream_server_port,
        p2p_sync::p2p_sync_info,
        p2p_sync::p2p_sync_configure,
        p2p_sync::p2p_sync_update_snapshot,
        p2p_sync::p2p_sync_update_playback,
        ytdlp_setup::ytdlp_ensure_installed,
        discord::discord_connect,
        discord::discord_disconnect,
        discord::discord_set_activity,
        discord::discord_clear_activity,
        bridge::bridge_respond,
        bridge::bridge_notify,
        history::commands::history_record_event,
        history::commands::history_fetch,
        history::commands::history_delete_range,
        history::commands::history_hourly_listening_time,
        history::commands::history_daily_listening_time,
        history::commands::history_first_play_at,
        history::commands::history_top_artists,
        history::commands::history_top_albums,
        history::commands::history_top_tracks
    ])
}

#[cfg(feature = "seed-user-data")]
const INITIAL_USER_DATA_ZIP: &[u8] = include_bytes!("../initial_user_data.zip");

#[cfg(feature = "seed-user-data")]
fn seed_initial_user_data(app_handle: &tauri::AppHandle) {
    use std::fs;
    use std::io::Cursor;
    use tauri::Manager;
    use zip::ZipArchive;

    let Ok(data_dir) = app_handle.path().app_data_dir() else {
        return;
    };
    let seed_marker = data_dir.join(".seed_v2");
    if seed_marker.exists() {
        return;
    }
    let plugins_json_path = data_dir.join("plugins.json");

    log::info!(
        "First launch detected; seeding initial user data into {:?}",
        data_dir
    );
    let _ = fs::create_dir_all(&data_dir);

    let Ok(mut archive) = ZipArchive::new(Cursor::new(INITIAL_USER_DATA_ZIP)) else {
        return;
    };

    for i in 0..archive.len() {
        let Ok(mut entry) = archive.by_index(i) else {
            continue;
        };
        let out_path = data_dir.join(entry.mangled_name());
        if entry.is_dir() {
            let _ = fs::create_dir_all(&out_path);
        } else {
            if let Some(parent) = out_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Ok(mut out_file) = fs::File::create(&out_path) {
                let _ = std::io::copy(&mut entry, &mut out_file);
            }
        }
    }

    if let Ok(contents) = fs::read_to_string(&plugins_json_path) {
        let new_base = data_dir.to_string_lossy();
        let rewritten = contents.replace("/home/mustrafa/.local/share/com.nuclearplayer", &new_base);
        let _ = fs::write(&plugins_json_path, rewritten);
    }
    let _ = fs::write(&seed_marker, b"ok");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let is_flatpak = std::env::var("FLATPAK_ID").is_ok();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let profile = profile::parse_profile(std::env::args()).unwrap_or_else(|message| {
        eprintln!("{message}");
        std::process::exit(1);
    });
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let profile: Option<String> = None;

    let mut context: tauri::Context<tauri::Wry> = tauri::generate_context!();
    let default_identifier = context.config().identifier.clone();
    if let Some(name) = &profile {
        context.config_mut().identifier = profile::profile_identifier(&default_identifier, name);
    }

    let specta_builder = specta_builder();

    #[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]
    specta_builder
        .export(
            typescript_export_config(),
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../src/services/tauri/bindings.ts"
            ),
        )
        .expect("failed to export typescript bindings");

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_upload::init())
        .plugin(setup::log_plugin());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        .difference(tauri_plugin_window_state::StateFlags::VISIBLE),
                )
                .build(),
        );

        if !is_flatpak {
            builder = builder
                .plugin(tauri_plugin_updater::Builder::new().build())
                .plugin(tauri_plugin_process::init());
        }
    }

    builder
        .invoke_handler(specta_builder.invoke_handler())
        .manage(profile::DefaultIdentifier(default_identifier))
        .setup(move |app| {
            if let Some(name) = &profile {
                log::info!("Using profile {name}");
            }
            #[cfg(feature = "seed-user-data")]
            seed_initial_user_data(app.handle());
            logging::mark_startup_complete();
            bridge::init_bridge(app.handle().clone());
            mcp::init_mcp(app.handle().clone());
            mpd::init_mpd(app.handle().clone());
            http_api::init_http_api(app.handle().clone());
            stream_server::init_stream_server(app.handle().clone());
            p2p_sync::init_p2p_sync(app.handle().clone());
            discord::init_discord(app.handle().clone());
            history::init_history(app.handle().clone());

            #[cfg(target_os = "linux")]
            maximize_for_gamescope(app);

            Ok(())
        })
        .run(context)
        .expect("error while running tauri application");
}

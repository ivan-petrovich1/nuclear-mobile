use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::BufReader;
use std::path::{Path, PathBuf};
use tauri::command;
use zip::ZipArchive;

#[command]
#[specta::specta]
pub fn is_flatpak() -> bool {
    std::env::var("FLATPAK_ID").is_ok()
}

#[command]
#[specta::specta]
pub fn copy_dir_recursive(from: PathBuf, to: PathBuf) -> Result<(), String> {
    fn inner(from: &Path, to: &Path) -> Result<(), std::io::Error> {
        fs::create_dir_all(to)?;
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            let from_path = entry.path();
            let to_path: PathBuf = to.join(entry.file_name());
            if file_type.is_dir() {
                inner(&from_path, &to_path)?;
            } else if file_type.is_file() {
                if let Some(parent) = to_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::copy(&from_path, &to_path)?;
            } else if file_type.is_symlink() {
                let target = fs::read_link(&from_path)?;
                let target_abs = if target.is_absolute() {
                    target
                } else {
                    from_path.parent().unwrap_or(from).join(target)
                };
                if target_abs.is_dir() {
                    inner(&target_abs, &to_path)?;
                } else if target_abs.is_file() {
                    if let Some(parent) = to_path.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    fs::copy(&target_abs, &to_path)?;
                }
            }
        }
        Ok(())
    }

    let from_p = Path::new(&from);
    let to_p = Path::new(&to);
    inner(from_p, to_p).map_err(|e| {
        log::error!("copy_dir_recursive failed: {}", e);
        e.to_string()
    })
}

#[command]
#[specta::specta]
pub fn extract_zip(zip_path: PathBuf, dest_path: PathBuf) -> Result<(), String> {
    fn inner(zip_path: &Path, dest_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
        let file = File::open(zip_path)?;
        let mut archive = ZipArchive::new(BufReader::new(file))?;
        fs::create_dir_all(dest_path)?;

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i)?;
            // Use mangled_name to prevent zip slip attacks
            let out_path = dest_path.join(entry.mangled_name());

            if entry.is_dir() {
                fs::create_dir_all(&out_path)?;
            } else {
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                let mut out_file = File::create(&out_path)?;
                std::io::copy(&mut entry, &mut out_file)?;

                #[cfg(unix)]
                if let Some(mode) = entry.unix_mode() {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(&out_path, fs::Permissions::from_mode(mode & 0o777)).ok();
                }
            }
        }
        Ok(())
    }

    inner(&zip_path, &dest_path).map_err(|e| {
        log::error!("extract_zip failed for {:?}: {}", zip_path, e);
        e.to_string()
    })?;

    log::info!("Extracted {:?} to {:?}", zip_path, dest_path);
    Ok(())
}

#[command]
#[specta::specta]
pub fn sha256_file(path: PathBuf) -> Result<String, String> {
    fn inner(path: &Path) -> Result<String, Box<dyn std::error::Error>> {
        let digest = Sha256::digest(fs::read(path)?);
        Ok(digest.iter().map(|byte| format!("{:02x}", byte)).collect())
    }

    inner(&path).map_err(|e| {
        log::error!("sha256_file failed for {:?}: {}", path, e);
        e.to_string()
    })
}

fn parse_total_from_content_range(header_val: &str) -> Option<u64> {
    let (_, total_str) = header_val.split_once('/')?;
    if total_str.trim() == "*" {
        return None;
    }
    total_str.trim().parse::<u64>().ok()
}

#[command]
#[specta::specta]
pub async fn download_file(url: String, dest_path: PathBuf) -> Result<(), String> {
    use futures::StreamExt;
    use reqwest::header::RANGE;
    use reqwest::StatusCode;
    use std::time::Duration;
    use tokio::io::AsyncWriteExt;

    const CHUNK_SIZE: u64 = 512 * 1024;
    const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

    async fn stream_body_to_file(
        response: reqwest::Response,
        file: &mut tokio::fs::File,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            file.write_all(&chunk).await?;
        }
        Ok(())
    }

    async fn inner(url: &str, raw_dest_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
        let raw_str = raw_dest_path.to_string_lossy();
        let (dest_str, export_name) = match raw_str.split_once('|') {
            Some((d, e)) => (d.to_string(), Some(e.to_string())),
            None => (raw_str.to_string(), None),
        };
        let dest_path = Path::new(&dest_str);

        log::info!("Downloading {} to {:?}", url, dest_path);

        let client = crate::net::http_client_builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(20))
            .build()?;

        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let tmp_path = dest_path.with_extension("part");
        let download_result: Result<(), Box<dyn std::error::Error>> = async {
            let mut file = tokio::fs::File::create(&tmp_path).await?;

            // Use Range-chunked requests first: avoids YouTube googlevideo.com non-Range throttling/stalls
            let first_range = format!("bytes=0-{}", CHUNK_SIZE - 1);
            let first_resp = client.get(url).header(RANGE, &first_range).send().await?;
            let status = first_resp.status();

            if status == StatusCode::PARTIAL_CONTENT {
                let total_len = first_resp
                    .headers()
                    .get(reqwest::header::CONTENT_RANGE)
                    .and_then(|v| v.to_str().ok())
                    .and_then(parse_total_from_content_range);

                let first_bytes = first_resp.bytes().await?;
                file.write_all(&first_bytes).await?;
                let mut offset = first_bytes.len() as u64;

                if !first_bytes.is_empty() {
                    while total_len.map_or(true, |t| offset < t) {
                        let range_end = total_len
                            .map(|t| (offset + CHUNK_SIZE - 1).min(t - 1))
                            .unwrap_or(offset + CHUNK_SIZE - 1);
                        let range_hdr = format!("bytes={offset}-{range_end}");

                        let mut chunk_data = None;
                        let mut reached_eof = false;
                        let mut last_err: Option<String> = None;

                        for _attempt in 0..3 {
                            match client.get(url).header(RANGE, &range_hdr).send().await {
                                Ok(resp) => {
                                    let st = resp.status();
                                    if st == StatusCode::RANGE_NOT_SATISFIABLE && total_len.is_none() {
                                        reached_eof = true;
                                        break;
                                    }
                                    if !st.is_success() && st != StatusCode::PARTIAL_CONTENT {
                                        last_err = Some(format!("HTTP error: {st}"));
                                        continue;
                                    }
                                    match resp.bytes().await {
                                        Ok(b) => {
                                            chunk_data = Some(b);
                                            break;
                                        }
                                        Err(e) => {
                                            last_err = Some(e.to_string());
                                        }
                                    }
                                }
                                Err(e) => {
                                    last_err = Some(e.to_string());
                                }
                            }
                        }

                        if reached_eof {
                            break;
                        }
                        let Some(bytes) = chunk_data else {
                            return Err(last_err
                                .unwrap_or_else(|| "Chunk download failed".to_string())
                                .into());
                        };
                        if bytes.is_empty() {
                            break;
                        }
                        file.write_all(&bytes).await?;
                        offset += bytes.len() as u64;
                    }
                }
            } else if status.is_success() {
                // Non-range server (200 OK): increase stream client timeout if long body
                stream_body_to_file(first_resp, &mut file).await?;
            } else if status == StatusCode::RANGE_NOT_SATISFIABLE {
                let fallback_client = crate::net::http_client_builder()
                    .user_agent(USER_AGENT)
                    .timeout(Duration::from_secs(300))
                    .connect_timeout(Duration::from_secs(20))
                    .build()?;
                let resp = fallback_client.get(url).send().await?;
                if !resp.status().is_success() {
                    return Err(format!("HTTP error: {}", resp.status()).into());
                }
                stream_body_to_file(resp, &mut file).await?;
            } else {
                return Err(format!("HTTP error: {status}").into());
            }

            file.flush().await?;
            drop(file);
            Ok(())
        }
        .await;

        if let Err(err) = download_result {
            let _ = fs::remove_file(&tmp_path);
            return Err(err);
        }

        fs::rename(&tmp_path, dest_path)?;

        // On desktop, also save a copy to ~/Downloads/Nuclear if export_name is provided;
        // on Android, NuclearAndroid.exportToPublicDownloads writes via MediaStore.Downloads.
        #[cfg(not(target_os = "android"))]
        if let Some(nice_name) = export_name {
            let safe_name: String = nice_name
                .chars()
                .map(|c| match c {
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
                    _ => c,
                })
                .collect();

            let public_dir = std::env::var("HOME")
                .map(|h| PathBuf::from(h).join("Downloads").join("Nuclear"))
                .unwrap_or_else(|_| PathBuf::from("/tmp/Nuclear"));

            if fs::create_dir_all(&public_dir).is_ok() {
                let public_file = public_dir.join(safe_name);
                let _ = fs::copy(dest_path, &public_file);
            }
        }
        #[cfg(target_os = "android")]
        let _ = export_name;

        log::info!("Download complete: {:?}", dest_path);
        Ok(())
    }

    inner(&url, &dest_path).await.map_err(|e| {
        log::error!("download_file failed for {}: {}", url, e);
        e.to_string()
    })
}

#[command]
#[specta::specta]
pub async fn self_update_appimage(app: tauri::AppHandle, url: String) -> Result<bool, String> {
    #[cfg(target_os = "linux")]
    {
        use futures::StreamExt;
        use std::os::unix::fs::PermissionsExt;
        use std::time::Duration;
        use tauri::Emitter;
        use tokio::io::AsyncWriteExt;

        let Ok(appimage_str) = std::env::var("APPIMAGE") else {
            return Ok(false);
        };
        let appimage_str = appimage_str.trim().to_string();
        if appimage_str.is_empty() {
            return Ok(false);
        }
        let appimage_path = PathBuf::from(&appimage_str);
        if !appimage_path.is_file() {
            return Ok(false);
        }

        let tmp_path = PathBuf::from(format!("{appimage_str}.update.tmp"));
        let client = crate::net::http_client_builder()
            .user_agent("Nuclear-Updater/1.0")
            .timeout(Duration::from_secs(300))
            .connect_timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| e.to_string())?;

        let download_res: Result<(), Box<dyn std::error::Error>> = async {
            let resp = client.get(&url).send().await?;
            if !resp.status().is_success() {
                return Err(format!("HTTP error {}", resp.status()).into());
            }

            let content_len = resp.content_length();
            let mut file = tokio::fs::File::create(&tmp_path).await?;
            let mut stream = resp.bytes_stream();
            let mut total_bytes: u64 = 0;
            let mut magic = [0u8; 4];
            let mut magic_len = 0usize;
            let mut last_pct: i32 = -1;

            while let Some(chunk) = stream.next().await {
                let chunk = chunk?;
                if magic_len < 4 {
                    let take = (4 - magic_len).min(chunk.len());
                    magic[magic_len..magic_len + take].copy_from_slice(&chunk[..take]);
                    magic_len += take;
                }
                total_bytes += chunk.len() as u64;
                file.write_all(&chunk).await?;
                if let Some(len) = content_len {
                    if len > 0 {
                        let pct = ((total_bytes * 100) / len).min(99) as i32;
                        if last_pct < 0 || pct - last_pct >= 2 {
                            last_pct = pct;
                            let _ = app.emit("appimage-update-progress", pct as u32);
                        }
                    }
                }
            }
            file.flush().await?;
            drop(file);

            if magic_len < 4 || &magic != b"\x7fELF" {
                return Err("Downloaded file is not a valid ELF AppImage".into());
            }
            if total_bytes <= 1_000_000 {
                return Err(format!("Downloaded AppImage unexpectedly small ({total_bytes} bytes)").into());
            }

            fs::set_permissions(&tmp_path, fs::Permissions::from_mode(0o755))?;
            fs::rename(&tmp_path, &appimage_path)?;
            let _ = app.emit("appimage-update-progress", 100u32);
            Ok(())
        }
        .await;

        if let Err(err) = download_res {
            let _ = fs::remove_file(&tmp_path);
            return Err(err.to_string());
        }

        log::info!("Updated AppImage in place: {:?}", appimage_path);
        return Ok(true);
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, url);
        Ok(false)
    }
}

#[command]
#[specta::specta]
pub fn relaunch_appimage(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "linux")]
    {
        let Ok(appimage_str) = std::env::var("APPIMAGE") else {
            return Ok(false);
        };
        let appimage_str = appimage_str.trim();
        if appimage_str.is_empty() {
            return Ok(false);
        }
        let appimage_path = Path::new(appimage_str);
        if !appimage_path.is_file() {
            return Ok(false);
        }

        std::process::Command::new(appimage_path)
            .env_remove("APPIMAGE")
            .env_remove("APPDIR")
            .env_remove("OWD")
            .env_remove("ARGV0")
            .spawn()
            .map_err(|e| e.to_string())?;

        app.exit(0);
        return Ok(true);
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::FileOptions;
    use zip::ZipWriter;

    fn create_test_zip(path: &Path, files: &[(&str, &[u8])]) {
        let file = File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options: FileOptions<'_, ()> = FileOptions::default();

        for (name, content) in files {
            zip.start_file(*name, options).unwrap();
            zip.write_all(content).unwrap();
        }
        zip.finish().unwrap();
    }

    mod extract_zip {
        use super::*;
        use tempfile::tempdir;

        #[test]
        fn extracts_files() {
            let temp = tempdir().unwrap();
            let zip_path = temp.path().join("test.zip");
            let dest_path = temp.path().join("output");

            create_test_zip(
                &zip_path,
                &[
                    ("file1.txt", b"Content 1"),
                    ("file2.txt", b"Content 2"),
                    ("file3.txt", b"Content 3"),
                ],
            );

            extract_zip(zip_path, dest_path.clone()).unwrap();

            assert_eq!(
                fs::read_to_string(dest_path.join("file1.txt")).unwrap(),
                "Content 1"
            );
            assert_eq!(
                fs::read_to_string(dest_path.join("file2.txt")).unwrap(),
                "Content 2"
            );
            assert_eq!(
                fs::read_to_string(dest_path.join("file3.txt")).unwrap(),
                "Content 3"
            );
        }

        #[test]
        fn extracts_nested_directories() {
            let temp = tempdir().unwrap();
            let zip_path = temp.path().join("test.zip");
            let dest_path = temp.path().join("output");

            create_test_zip(
                &zip_path,
                &[
                    ("root.txt", b"root"),
                    ("sub/nested.txt", b"nested"),
                    ("sub/deep/file.txt", b"deep"),
                ],
            );

            extract_zip(zip_path, dest_path.clone()).unwrap();

            assert_eq!(
                fs::read_to_string(dest_path.join("root.txt")).unwrap(),
                "root"
            );
            assert_eq!(
                fs::read_to_string(dest_path.join("sub/nested.txt")).unwrap(),
                "nested"
            );
            assert_eq!(
                fs::read_to_string(dest_path.join("sub/deep/file.txt")).unwrap(),
                "deep"
            );
        }

        #[test]
        fn creates_destination_directory() {
            let temp = tempdir().unwrap();
            let zip_path = temp.path().join("test.zip");
            let dest_path = temp.path().join("new/nested/output");

            create_test_zip(&zip_path, &[("file.txt", b"content")]);

            assert!(!dest_path.exists());
            extract_zip(zip_path, dest_path.clone()).unwrap();
            assert!(dest_path.exists());
        }

        #[test]
        fn returns_error_for_nonexistent_zip() {
            let temp = tempdir().unwrap();
            let zip_path = temp.path().join("nonexistent.zip");
            let dest_path = temp.path().join("output");

            let result = extract_zip(zip_path, dest_path);

            assert!(result.is_err());
        }

        #[test]
        fn returns_error_for_invalid_zip() {
            let temp = tempdir().unwrap();
            let zip_path = temp.path().join("invalid.zip");
            let dest_path = temp.path().join("output");

            fs::write(&zip_path, b"not a zip file").unwrap();

            let result = extract_zip(zip_path, dest_path);

            assert!(result.is_err());
        }
    }
}

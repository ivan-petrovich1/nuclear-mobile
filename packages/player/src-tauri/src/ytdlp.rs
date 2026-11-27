use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use log::{debug, error};
use std::process::{Command, Stdio};
use tauri::{command, AppHandle};

use crate::ytdlp_setup::ensure_binary;

#[derive(serde::Serialize, Debug, PartialEq, specta::Type)]
pub struct YtdlpStreamInfo {
    pub stream_url: String,
    pub duration: Option<f64>,
    pub title: Option<String>,
    pub container: Option<String>,
    pub codec: Option<String>,
    pub album: Option<String>,
    pub artists: Vec<String>,
    pub album_artists: Vec<String>,
    pub upload_date: Option<String>,
}

#[derive(serde::Serialize, Debug, PartialEq, specta::Type)]
pub struct YtdlpSearchResult {
    pub id: String,
    pub title: String,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub channel: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq, specta::Type)]
pub struct YtdlpThumbnail {
    pub url: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(serde::Serialize, Debug, PartialEq, specta::Type)]
pub struct YtdlpPlaylistEntry {
    pub id: String,
    pub title: String,
    pub duration: Option<f64>,
    pub thumbnails: Vec<YtdlpThumbnail>,
    pub channel: Option<String>,
}

#[derive(serde::Serialize, Debug, PartialEq, specta::Type)]
pub struct YtdlpPlaylistInfo {
    pub id: String,
    pub title: String,
    pub entries: Vec<YtdlpPlaylistEntry>,
}

#[derive(serde::Deserialize)]
struct YtdlpJson {
    id: Option<String>,
    title: Option<String>,
    duration: Option<f64>,
    url: Option<String>,
    thumbnail: Option<String>,
    thumbnails: Option<Vec<YtdlpThumbnail>>,
    ext: Option<String>,
    acodec: Option<String>,
    playlist_title: Option<String>,
    playlist_id: Option<String>,
    channel: Option<String>,
    album: Option<String>,
    artist: Option<String>,
    artists: Option<Vec<String>>,
    album_artist: Option<String>,
    album_artists: Option<Vec<String>>,
    creators: Option<Vec<String>>,
    upload_date: Option<String>,
}

fn build_args<'a>(options: &[&'a str], target: &'a str) -> Vec<&'a str> {
    let mut args = options.to_vec();
    args.push("--");
    args.push(target);
    args
}

async fn run_ytdlp(
    app_handle: &AppHandle,
    options: &[&str],
    target: &str,
) -> Result<String, String> {
    let program = ensure_binary(app_handle).await?;
    let mut cmd = Command::new(&program);
    cmd.args(build_args(options, target))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output().map_err(|error| {
        error!("[yt-dlp] Failed to execute: {}", error);
        format!("Failed to execute yt-dlp: {}. Is yt-dlp installed?", error)
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!("[yt-dlp] Command failed: {}", stderr);
        return Err(format!("yt-dlp failed: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn parse_ndjson_entries(stdout: &str) -> Vec<YtdlpJson> {
    stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<YtdlpJson>(line).ok())
        .collect()
}

fn normalize_artists(info: &YtdlpJson) -> Vec<String> {
    info.artists
        .clone()
        .or_else(|| info.creators.clone())
        .or_else(|| info.artist.as_ref().map(|a| vec![a.clone()]))
        .unwrap_or_default()
}

fn normalize_album_artists(info: &YtdlpJson) -> Vec<String> {
    info.album_artists
        .clone()
        .or_else(|| info.album_artist.as_ref().map(|a| vec![a.clone()]))
        .unwrap_or_default()
}

static VISITOR_DATA: tokio::sync::OnceCell<String> = tokio::sync::OnceCell::const_new();

fn parse_duration_text(text: &str) -> Option<f64> {
    let parts: Vec<f64> = text
        .trim()
        .split(':')
        .filter_map(|p| p.trim().parse::<f64>().ok())
        .collect();
    match parts.as_slice() {
        [m, s] => Some(m * 60.0 + s),
        [h, m, s] => Some(h * 3600.0 + m * 60.0 + s),
        [s] => Some(*s),
        _ => None,
    }
}

fn extract_video_id(input: &str) -> String {
    let trimmed = input.trim();
    if let Some(id) = trimmed.strip_prefix("yt:") {
        return id.trim().to_string();
    }
    if let Some(idx) = trimmed.find("v=") {
        let rest = &trimmed[idx + 2..];
        let end = rest.find(['&', '#', '?']).unwrap_or(rest.len());
        return rest[..end].to_string();
    }
    if let Some(idx) = trimmed.find("youtu.be/") {
        let rest = &trimmed[idx + 9..];
        let end = rest.find(['&', '#', '?', '/']).unwrap_or(rest.len());
        return rest[..end].to_string();
    }
    trimmed.to_string()
}

fn normalize_stream_url(input: &str) -> String {
    let trimmed = input.trim();
    if let Some(id) = trimmed.strip_prefix("yt:") {
        return format!("https://www.youtube.com/watch?v={}", id.trim());
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return trimmed.to_string();
    }
    if trimmed.len() == 11
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return format!("https://www.youtube.com/watch?v={trimmed}");
    }
    let decoded_bytes = URL_SAFE_NO_PAD
        .decode(trimmed.trim_end_matches('='))
        .or_else(|_| STANDARD.decode(trimmed));
    if let Ok(bytes) = decoded_bytes {
        if let Ok(decoded) = String::from_utf8(bytes) {
            let candidate = decoded.trim();
            if candidate.starts_with("http://") || candidate.starts_with("https://") {
                return candidate.to_string();
            }
        }
    }
    trimmed.to_string()
}

fn collect_renderers<'a>(
    val: &'a serde_json::Value,
    key: &str,
    out: &mut Vec<&'a serde_json::Value>,
) {
    match val {
        serde_json::Value::Object(map) => {
            if let Some(found) = map.get(key) {
                out.push(found);
            }
            for v in map.values() {
                collect_renderers(v, key, out);
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                collect_renderers(v, key, out);
            }
        }
        _ => {}
    }
}

async fn get_visitor_data(client: &reqwest::Client) -> String {
    VISITOR_DATA
        .get_or_init(|| async {
            if let Ok(resp) = client.get("https://www.youtube.com/sw.js_data").send().await {
                if let Ok(text) = resp.text().await {
                    let clean = text.trim_start_matches(")]}'").trim_start();
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(clean) {
                        if let Some(vd) = json.pointer("/0/2/0/0/13").and_then(|v| v.as_str()) {
                            return vd.to_string();
                        }
                    }
                }
            }
            String::new()
        })
        .await
        .clone()
}

async fn innertube_search(query: &str, limit: u32) -> Result<Vec<YtdlpSearchResult>, String> {
    let client = crate::net::http_client_builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "context": {
            "client": {
                "clientName": "WEB",
                "clientVersion": "2.20250101.00.00",
                "hl": "en",
                "gl": "US"
            }
        },
        "query": query
    });

    let resp = client
        .post("https://www.youtube.com/youtubei/v1/search?prettyPrint=false")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("InnerTube search failed: {e}"))?;

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("InnerTube search JSON error: {e}"))?;

    let mut renderers = Vec::new();
    collect_renderers(&json, "videoRenderer", &mut renderers);

    let mut results = Vec::new();
    for v in renderers {
        if results.len() >= limit as usize {
            break;
        }
        let Some(id) = v.get("videoId").and_then(|x| x.as_str()) else {
            continue;
        };
        let title = v
            .pointer("/title/runs/0/text")
            .or_else(|| v.pointer("/title/simpleText"))
            .and_then(|x| x.as_str())
            .unwrap_or("Unknown")
            .to_string();
        let duration = v
            .pointer("/lengthText/simpleText")
            .and_then(|x| x.as_str())
            .and_then(parse_duration_text);
        let thumbnail = v
            .pointer("/thumbnail/thumbnails")
            .and_then(|x| x.as_array())
            .and_then(|arr| arr.last())
            .and_then(|t| t.get("url"))
            .and_then(|u| u.as_str())
            .map(|s| s.to_string());
        let channel = v
            .pointer("/ownerText/runs/0/text")
            .or_else(|| v.pointer("/longBylineText/runs/0/text"))
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());

        results.push(YtdlpSearchResult {
            id: id.to_string(),
            title,
            duration,
            thumbnail,
            channel,
        });
    }

    Ok(results)
}

fn is_unsupported_surround_codec(mime_or_codec: &str) -> bool {
    let lower = mime_or_codec.to_ascii_lowercase();
    lower.contains("ec-3")
        || lower.contains("ac-3")
        || lower.contains("dtse")
        || lower.contains("dtsx")
        || lower.contains("iamf")
        || lower.contains("mp4a.40.42")
}

fn select_best_innertube_audio_format<'a>(
    formats: &'a [serde_json::Value],
) -> Option<&'a serde_json::Value> {
    let mut audio_formats: Vec<&serde_json::Value> = formats
        .iter()
        .filter(|f| {
            f.get("mimeType")
                .and_then(|m| m.as_str())
                .map(|m| m.starts_with("audio/"))
                .unwrap_or(false)
                && f.get("url")
                    .and_then(|u| u.as_str())
                    .map(|u| !u.trim().is_empty())
                    .unwrap_or(false)
        })
        .collect();

    audio_formats.sort_by_key(|f| {
        let mime_lower = f
            .get("mimeType")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let playable_codec = u8::from(!is_unsupported_surround_codec(&mime_lower));
        let is_stereo_or_mono =
            u8::from(f.get("audioChannels").and_then(|c| c.as_u64()).unwrap_or(2) <= 2);
        let not_auto_dubbed = u8::from(
            !f.pointer("/audioTrack/isAutoDubbed")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        );
        let codec_tier = if mime_lower.contains("audio/mp4") && mime_lower.contains("mp4a") {
            3u8
        } else if mime_lower.contains("audio/webm") && mime_lower.contains("opus") {
            2u8
        } else if mime_lower.contains("audio/mp4") {
            1u8
        } else {
            0u8
        };
        let bitrate = f.get("bitrate").and_then(|b| b.as_u64()).unwrap_or(0);
        (
            playable_codec,
            is_stereo_or_mono,
            not_auto_dubbed,
            codec_tier,
            bitrate,
        )
    });

    audio_formats.into_iter().last()
}

fn select_best_piped_audio_stream<'a>(
    streams: &'a [serde_json::Value],
) -> Option<&'a serde_json::Value> {
    let mut valid: Vec<&serde_json::Value> = streams
        .iter()
        .filter(|s| {
            s.get("url")
                .and_then(|u| u.as_str())
                .map(|u| !u.trim().is_empty())
                .unwrap_or(false)
        })
        .collect();

    valid.sort_by_key(|s| {
        let mime_lower = s
            .get("mimeType")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let codec_lower = s
            .get("codec")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let playable_codec = u8::from(
            !is_unsupported_surround_codec(&mime_lower)
                && !is_unsupported_surround_codec(&codec_lower),
        );
        let codec_tier = if mime_lower.contains("mp4")
            || mime_lower.contains("m4a")
            || codec_lower.contains("mp4a")
        {
            2u8
        } else if mime_lower.contains("webm") || codec_lower.contains("opus") {
            1u8
        } else {
            0u8
        };
        let bitrate = s.get("bitrate").and_then(|b| b.as_u64()).unwrap_or(0);
        (playable_codec, codec_tier, bitrate)
    });

    valid.into_iter().last()
}

async fn innertube_get_stream(target: &str) -> Result<YtdlpStreamInfo, String> {
    let video_id = extract_video_id(target);
    let client = crate::net::http_client_builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let visitor_data = get_visitor_data(&client).await;

    let clients = [
        (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
            serde_json::json!({
                "clientName": "VISIONOS",
                "clientVersion": "0.1",
                "deviceMake": "Apple",
                "deviceModel": "RealityDevice14,1",
                "osName": "visionOS",
                "osVersion": "1.3.21O771",
                "hl": "en",
                "gl": "US",
                "visitorData": visitor_data
            }),
        ),
        (
            "com.google.ios.youtube/20.03.02 (iPhone16,2; U; CPU iOS 18_2_1 like Mac OS X;)",
            serde_json::json!({
                "clientName": "IOS",
                "clientVersion": "20.03.02",
                "deviceMake": "Apple",
                "deviceModel": "iPhone16,2",
                "osName": "iPhone",
                "osVersion": "18.2.1.22C161",
                "hl": "en",
                "gl": "US",
                "visitorData": visitor_data
            }),
        ),
        (
            "Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15",
            serde_json::json!({
                "clientName": "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
                "clientVersion": "2.0",
                "hl": "en",
                "gl": "US",
                "visitorData": visitor_data
            }),
        ),
    ];

    for (ua, client_ctx) in clients {
        let body = serde_json::json!({
            "context": { "client": client_ctx },
            "videoId": video_id,
            "contentCheckOk": true,
            "racyCheckOk": true
        });

        let mut req = client
            .post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
            .header("User-Agent", ua);
        if !visitor_data.is_empty() {
            req = req.header("X-Goog-Visitor-Id", &visitor_data);
        }

        let Ok(resp) = req.json(&body).send().await else {
            continue;
        };
        let Ok(json) = resp.json::<serde_json::Value>().await else {
            continue;
        };

        let Some(formats) = json
            .pointer("/streamingData/adaptiveFormats")
            .and_then(|f| f.as_array())
        else {
            continue;
        };

        let Some(chosen) = select_best_innertube_audio_format(formats) else {
            continue;
        };
        let stream_url = chosen
            .get("url")
            .and_then(|u| u.as_str())
            .unwrap()
            .to_string();
        let mime = chosen
            .get("mimeType")
            .and_then(|m| m.as_str())
            .unwrap_or("audio/mp4");
        let container = if mime.contains("webm") {
            Some("webm".to_string())
        } else {
            Some("m4a".to_string())
        };
        let codec = chosen
            .get("mimeType")
            .and_then(|m| m.as_str())
            .and_then(|m| m.split("codecs=\"").nth(1))
            .and_then(|s| s.strip_suffix('"'))
            .map(|s| s.to_string());

        let title = json
            .pointer("/videoDetails/title")
            .and_then(|t| t.as_str())
            .map(|s| s.to_string());
        let author = json
            .pointer("/videoDetails/author")
            .and_then(|a| a.as_str())
            .map(|s| s.to_string());
        let duration = json
            .pointer("/videoDetails/lengthSeconds")
            .and_then(|l| l.as_str())
            .and_then(|l| l.parse::<f64>().ok())
            .or_else(|| {
                chosen
                    .get("approxDurationMs")
                    .and_then(|d| d.as_str())
                    .and_then(|d| d.parse::<f64>().ok())
                    .map(|ms| ms / 1000.0)
            });

        return Ok(YtdlpStreamInfo {
            stream_url,
            duration,
            title,
            container,
            codec,
            album: None,
            artists: author.into_iter().collect(),
            album_artists: Vec::new(),
            upload_date: None,
        });
    }

    // Automatic failover to public Piped API instances if InnerTube is rate-limited
    let piped_instances = [
        "https://pipedapi.kavin.rocks",
        "https://api.piped.private.coffee",
        "https://pipedapi.adminforge.de",
    ];
    for base in piped_instances {
        let url = format!("{base}/streams/{video_id}");
        let Ok(resp) = client.get(&url).send().await else {
            continue;
        };
        if !resp.status().is_success() {
            continue;
        }
        let Ok(json) = resp.json::<serde_json::Value>().await else {
            continue;
        };
        let Some(streams) = json.get("audioStreams").and_then(|s| s.as_array()) else {
            continue;
        };
        let Some(chosen) = select_best_piped_audio_stream(streams) else {
            continue;
        };
        let stream_url = chosen
            .get("url")
            .and_then(|u| u.as_str())
            .unwrap()
            .to_string();
        let mime_lower = chosen
            .get("mimeType")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let raw_codec = chosen
            .get("codec")
            .and_then(|c| c.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        let is_webm = mime_lower.contains("webm")
            || raw_codec
                .map(|c| c.eq_ignore_ascii_case("opus"))
                .unwrap_or(false);
        let container = if is_webm {
            Some("webm".to_string())
        } else {
            Some("m4a".to_string())
        };
        let codec = raw_codec.map(str::to_string).or_else(|| {
            if is_webm {
                Some("opus".to_string())
            } else {
                Some("mp4a.40.2".to_string())
            }
        });
        let title = json
            .get("title")
            .and_then(|t| t.as_str())
            .map(|s| s.to_string());
        let uploader = json
            .get("uploader")
            .and_then(|u| u.as_str())
            .map(|s| s.to_string());
        let duration = json.get("duration").and_then(|d| d.as_f64());
        return Ok(YtdlpStreamInfo {
            stream_url,
            duration,
            title,
            container,
            codec,
            album: None,
            artists: uploader.into_iter().collect(),
            album_artists: Vec::new(),
            upload_date: None,
        });
    }

    Err("Failed to resolve YouTube audio stream via InnerTube or failover instances".to_string())
}

async fn innertube_get_playlist(url: &str) -> Result<YtdlpPlaylistInfo, String> {
    let list_id = if let Some(idx) = url.find("list=") {
        let rest = &url[idx + 5..];
        let end = rest.find(['&', '#']).unwrap_or(rest.len());
        rest[..end].to_string()
    } else {
        url.trim().to_string()
    };

    let client = crate::net::http_client_builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "context": {
            "client": {
                "clientName": "WEB",
                "clientVersion": "2.20250101.00.00",
                "hl": "en",
                "gl": "US"
            }
        },
        "browseId": format!("VL{}", list_id)
    });

    let resp = client
        .post("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("InnerTube playlist request failed: {e}"))?;

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("InnerTube playlist JSON error: {e}"))?;

    let title = json
        .pointer("/metadata/playlistMetadataRenderer/title")
        .and_then(|t| t.as_str())
        .unwrap_or("Playlist")
        .to_string();

    let mut renderers = Vec::new();
    collect_renderers(&json, "playlistVideoRenderer", &mut renderers);

    let mut entries = Vec::new();
    for v in renderers {
        let Some(id) = v.get("videoId").and_then(|x| x.as_str()) else {
            continue;
        };
        let entry_title = v
            .pointer("/title/runs/0/text")
            .or_else(|| v.pointer("/title/simpleText"))
            .and_then(|x| x.as_str())
            .unwrap_or("Unknown")
            .to_string();
        let duration = v
            .pointer("/lengthSeconds")
            .and_then(|x| x.as_str())
            .and_then(|s| s.parse::<f64>().ok())
            .or_else(|| {
                v.pointer("/lengthText/simpleText")
                    .and_then(|x| x.as_str())
                    .and_then(parse_duration_text)
            });
        let thumbnails = v
            .pointer("/thumbnail/thumbnails")
            .and_then(|x| x.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|t| serde_json::from_value::<YtdlpThumbnail>(t.clone()).ok())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let channel = v
            .pointer("/shortBylineText/runs/0/text")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());

        entries.push(YtdlpPlaylistEntry {
            id: id.to_string(),
            title: entry_title,
            duration,
            thumbnails,
            channel,
        });
    }

    Ok(YtdlpPlaylistInfo {
        id: list_id,
        title,
        entries,
    })
}

#[command]
#[specta::specta]
pub async fn ytdlp_search(
    app_handle: AppHandle,
    query: String,
    max_results: Option<u32>,
) -> Result<Vec<YtdlpSearchResult>, String> {
    let limit = max_results.unwrap_or(10);
    debug!("[yt-dlp] Searching: {} (limit: {})", query, limit);

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = app_handle;
        return innertube_search(&query, limit).await;
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let search_url = format!("ytsearch{}:{}", limit, query);
        let stdout = match run_ytdlp(
            &app_handle,
            &["--dump-json", "--flat-playlist", "--no-warnings"],
            &search_url,
        )
        .await
        {
            Ok(out) => out,
            Err(_) => return innertube_search(&query, limit).await,
        };

        let results: Vec<YtdlpSearchResult> = parse_ndjson_entries(&stdout)
            .into_iter()
            .filter_map(|entry| {
                entry.id.map(|id| YtdlpSearchResult {
                    id,
                    title: entry.title.unwrap_or_else(|| "Unknown".to_string()),
                    duration: entry.duration,
                    thumbnail: entry.thumbnail.or_else(|| {
                        entry
                            .thumbnails
                            .unwrap_or_default()
                            .last()
                            .map(|thumbnail| thumbnail.url.clone())
                    }),
                    channel: entry.channel,
                })
            })
            .collect();

        debug!("[yt-dlp] Found {} results", results.len());
        Ok(results)
    }
}

#[command]
#[specta::specta]
// TODO: Remove video_id parameter after plugins have auto-updated to use url
pub async fn ytdlp_get_stream(
    app_handle: AppHandle,
    url: Option<String>,
    video_id: Option<String>,
) -> Result<YtdlpStreamInfo, String> {
    let resolved_url = match (url, video_id) {
        (Some(url), _) => normalize_stream_url(&url),
        (None, Some(id)) => {
            let normalized = normalize_stream_url(&id);
            if normalized.starts_with("http://") || normalized.starts_with("https://") {
                normalized
            } else {
                format!("https://www.youtube.com/watch?v={}", id.trim())
            }
        }
        (None, None) => return Err("Either url or video_id must be provided".to_string()),
    };

    debug!("[yt-dlp] Getting stream for: {}", resolved_url);

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = app_handle;
        return innertube_get_stream(&resolved_url).await;
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let stdout = match run_ytdlp(
            &app_handle,
            &[
                "-f",
                "bestaudio[ext=m4a][acodec^=mp4a]/bestaudio[ext=webm]/bestaudio[acodec^=mp4a]/bestaudio",
                "--dump-json",
                "--no-playlist",
                "--no-warnings",
            ],
            &resolved_url,
        )
        .await
        {
            Ok(out) => out,
            Err(_) => return innertube_get_stream(&resolved_url).await,
        };

        let info: YtdlpJson = serde_json::from_str(&stdout).map_err(|error| {
            error!("[yt-dlp] Failed to parse output: {}", error);
            format!("Failed to parse yt-dlp output: {}", error)
        })?;

        let artists = normalize_artists(&info);
        let album_artists = normalize_album_artists(&info);

        let stream_url = info.url.ok_or_else(|| {
            error!("[yt-dlp] No URL in output");
            "No stream URL returned by yt-dlp".to_string()
        })?;

        debug!(
            "[yt-dlp] Got stream for '{}', duration: {:?}s",
            info.title.as_deref().unwrap_or("Unknown"),
            info.duration
        );

        Ok(YtdlpStreamInfo {
            stream_url,
            duration: info.duration,
            title: info.title,
            container: info.ext,
            codec: info.acodec,
            album: info.album,
            artists,
            album_artists,
            upload_date: info.upload_date,
        })
    }
}

#[command]
#[specta::specta]
pub async fn ytdlp_get_playlist(
    app_handle: AppHandle,
    url: String,
) -> Result<YtdlpPlaylistInfo, String> {
    debug!("[yt-dlp] Getting playlist: {}", url);

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = app_handle;
        return innertube_get_playlist(&url).await;
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let stdout = match run_ytdlp(
            &app_handle,
            &["--dump-json", "--flat-playlist", "--no-warnings"],
            &url,
        )
        .await
        {
            Ok(out) => out,
            Err(_) => return innertube_get_playlist(&url).await,
        };
        let entries_json = parse_ndjson_entries(&stdout);

        let playlist_title = entries_json
            .iter()
            .find_map(|entry| entry.playlist_title.clone())
            .ok_or_else(|| {
                error!("[yt-dlp] No playlist metadata found in output");
                "No playlist metadata found in yt-dlp output".to_string()
            })?;

        let playlist_id = entries_json
            .iter()
            .find_map(|entry| entry.playlist_id.clone())
            .unwrap_or_default();

        let entries: Vec<YtdlpPlaylistEntry> = entries_json
            .into_iter()
            .filter_map(|entry| {
                entry.id.map(|id| YtdlpPlaylistEntry {
                    id,
                    title: entry.title.unwrap_or_else(|| "Unknown".to_string()),
                    duration: entry.duration,
                    thumbnails: entry.thumbnails.unwrap_or_default(),
                    channel: entry.channel,
                })
            })
            .collect();

        debug!(
            "[yt-dlp] Playlist '{}' has {} entries",
            playlist_title,
            entries.len()
        );

        Ok(YtdlpPlaylistInfo {
            id: playlist_id,
            title: playlist_title,
            entries,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_json() -> YtdlpJson {
        YtdlpJson {
            id: None,
            title: None,
            duration: None,
            url: None,
            thumbnail: None,
            thumbnails: None,
            ext: None,
            acodec: None,
            playlist_title: None,
            playlist_id: None,
            channel: None,
            album: None,
            artist: None,
            artists: None,
            album_artist: None,
            album_artists: None,
            creators: None,
            upload_date: None,
        }
    }

    mod parse_ndjson {
        use super::*;

        #[test]
        fn parses_multiple_lines() {
            let input = r#"{"id":"v1","title":"First"}
{"id":"v2","title":"Second"}"#;

            let results = parse_ndjson_entries(input);

            assert_eq!(results.len(), 2);
            assert_eq!(results[0].id.as_deref(), Some("v1"));
            assert_eq!(results[1].id.as_deref(), Some("v2"));
        }

        #[test]
        fn skips_malformed_lines() {
            let input = r#"{"id":"good"}
not json
{"id":"also_good"}"#;

            let results = parse_ndjson_entries(input);

            assert_eq!(results.len(), 2);
        }

        #[test]
        fn skips_empty_lines() {
            let input = "\n{\"id\":\"v1\"}\n\n{\"id\":\"v2\"}\n";

            let results = parse_ndjson_entries(input);

            assert_eq!(results.len(), 2);
        }

        #[test]
        fn returns_empty_vec_for_empty_input() {
            assert!(parse_ndjson_entries("").is_empty());
            assert!(parse_ndjson_entries("\n\n").is_empty());
        }
    }

    mod normalize_artists_tests {
        use super::*;

        #[test]
        fn prefers_artists_over_creators() {
            let json = YtdlpJson {
                artists: Some(vec!["Rick Astley".into()]),
                creators: Some(vec!["Someone Else".into()]),
                ..empty_json()
            };
            assert_eq!(normalize_artists(&json), vec!["Rick Astley"]);
        }

        #[test]
        fn falls_back_to_creators() {
            let json = YtdlpJson {
                creators: Some(vec!["Performer 1".into(), "Performer 2".into()]),
                ..empty_json()
            };
            assert_eq!(
                normalize_artists(&json),
                vec!["Performer 1", "Performer 2"]
            );
        }

        #[test]
        fn falls_back_to_artist_string() {
            let json = YtdlpJson {
                artist: Some("Solo Artist".into()),
                ..empty_json()
            };
            assert_eq!(normalize_artists(&json), vec!["Solo Artist"]);
        }

        #[test]
        fn returns_empty_when_all_null() {
            assert!(normalize_artists(&empty_json()).is_empty());
        }
    }

    mod normalize_album_artists_tests {
        use super::*;

        #[test]
        fn prefers_album_artists_over_album_artist() {
            let json = YtdlpJson {
                album_artists: Some(vec!["Group A".into(), "Group B".into()]),
                album_artist: Some("Ignored".into()),
                ..empty_json()
            };
            assert_eq!(
                normalize_album_artists(&json),
                vec!["Group A", "Group B"]
            );
        }

        #[test]
        fn wraps_album_artist_string_in_vec() {
            let json = YtdlpJson {
                album_artist: Some("The Band".into()),
                ..empty_json()
            };
            assert_eq!(normalize_album_artists(&json), vec!["The Band"]);
        }

        #[test]
        fn returns_empty_when_all_null() {
            assert!(normalize_album_artists(&empty_json()).is_empty());
        }
    }

    mod build_args_tests {
        use super::*;

        #[test]
        fn places_dash_prefixed_video_id_after_end_of_options_marker() {
            assert_eq!(
                build_args(&["--dump-json", "--no-warnings"], "-2-tGiD2MpU"),
                vec!["--dump-json", "--no-warnings", "--", "-2-tGiD2MpU"]
            );
        }
    }

    mod normalize_stream_url_tests {
        use super::*;

        #[test]
        fn expands_yt_scheme_prefix() {
            assert_eq!(
                normalize_stream_url("yt:dQw4w9WgXcQ"),
                "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
            );
            assert_eq!(extract_video_id("yt:dQw4w9WgXcQ"), "dQw4w9WgXcQ");
        }

        #[test]
        fn decodes_base64url_bandcamp_url() {
            assert_eq!(
                normalize_stream_url("aHR0cHM6Ly9sdWtlc3N0YXJzLmJhbmRjYW1wLmNvbS90cmFjay9taXNlcnk"),
                "https://lukesstars.bandcamp.com/track/misery"
            );
        }

        #[test]
        fn decodes_padded_standard_base64_url() {
            let encoded = STANDARD.encode("https://example.org/track?id=42");
            assert_eq!(
                normalize_stream_url(&encoded),
                "https://example.org/track?id=42"
            );
        }

        #[test]
        fn expands_bare_eleven_char_youtube_id() {
            assert_eq!(
                normalize_stream_url("-2-tGiD2MpU"),
                "https://www.youtube.com/watch?v=-2-tGiD2MpU"
            );
        }

        #[test]
        fn passes_through_http_urls_and_non_url_strings() {
            assert_eq!(
                normalize_stream_url("  https://soundcloud.com/artist/track  "),
                "https://soundcloud.com/artist/track"
            );
            assert_eq!(normalize_stream_url("not-a-valid-url"), "not-a-valid-url");
        }
    }

    mod select_best_audio_format_tests {
        use super::*;
        use serde_json::json;

        #[test]
        fn prefers_stereo_mp4a_over_higher_bitrate_dolby_codecs() {
            let formats = vec![
                json!({
                    "itag": 328,
                    "mimeType": "audio/mp4; codecs=\"ec-3\"",
                    "bitrate": 384000,
                    "audioChannels": 6,
                    "url": "https://example.com/ec3"
                }),
                json!({
                    "itag": 325,
                    "mimeType": "audio/mp4; codecs=\"ac-3\"",
                    "bitrate": 384000,
                    "audioChannels": 6,
                    "url": "https://example.com/ac3"
                }),
                json!({
                    "itag": 140,
                    "mimeType": "audio/mp4; codecs=\"mp4a.40.2\"",
                    "bitrate": 128000,
                    "audioChannels": 2,
                    "url": "https://example.com/aac"
                }),
            ];

            let chosen = select_best_innertube_audio_format(&formats).unwrap();
            assert_eq!(chosen["url"], "https://example.com/aac");
        }

        #[test]
        fn prefers_stereo_mp4a_over_multichannel_mp4a() {
            let formats = vec![
                json!({
                    "mimeType": "audio/mp4; codecs=\"mp4a.40.2\"",
                    "bitrate": 256000,
                    "audioChannels": 6,
                    "url": "https://example.com/aac-6ch"
                }),
                json!({
                    "mimeType": "audio/mp4; codecs=\"mp4a.40.2\"",
                    "bitrate": 128000,
                    "audioChannels": 2,
                    "url": "https://example.com/aac-2ch"
                }),
            ];

            let chosen = select_best_innertube_audio_format(&formats).unwrap();
            assert_eq!(chosen["url"], "https://example.com/aac-2ch");
        }

        #[test]
        fn prefers_original_track_over_auto_dubbed_track() {
            let formats = vec![
                json!({
                    "mimeType": "audio/mp4; codecs=\"mp4a.40.2\"",
                    "bitrate": 128000,
                    "audioChannels": 2,
                    "audioTrack": { "isAutoDubbed": true },
                    "url": "https://example.com/dubbed"
                }),
                json!({
                    "mimeType": "audio/mp4; codecs=\"mp4a.40.2\"",
                    "bitrate": 128000,
                    "audioChannels": 2,
                    "audioTrack": { "isAutoDubbed": false },
                    "url": "https://example.com/original"
                }),
            ];

            let chosen = select_best_innertube_audio_format(&formats).unwrap();
            assert_eq!(chosen["url"], "https://example.com/original");
        }

        #[test]
        fn falls_back_to_opus_webm_when_no_mp4a_is_available() {
            let formats = vec![
                json!({
                    "mimeType": "audio/mp4; codecs=\"ec-3\"",
                    "bitrate": 384000,
                    "audioChannels": 6,
                    "url": "https://example.com/ec3"
                }),
                json!({
                    "mimeType": "audio/webm; codecs=\"opus\"",
                    "bitrate": 160000,
                    "audioChannels": 2,
                    "url": "https://example.com/opus"
                }),
            ];

            let chosen = select_best_innertube_audio_format(&formats).unwrap();
            assert_eq!(chosen["url"], "https://example.com/opus");
        }
    }
}

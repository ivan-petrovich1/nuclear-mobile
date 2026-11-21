use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, Response, StatusCode};
use axum::routing::get;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::Client;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

const PORT_START: u16 = 9100;
const PORT_END: u16 = 9109;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

const FORWARD_HEADERS: &[header::HeaderName] = &[
    header::CONTENT_TYPE,
    header::CONTENT_LENGTH,
    header::CONTENT_RANGE,
    header::ACCEPT_RANGES,
];

pub struct StreamServerState {
    port: u16,
}

fn decode_stream_url(encoded: &str) -> Result<String, String> {
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|err| format!("Invalid base64 URL: {err}"))?;

    let url = String::from_utf8(bytes).map_err(|err| format!("Invalid UTF-8 in URL: {err}"))?;

    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Invalid URL scheme. Expected http(s)".to_string());
    }

    Ok(url)
}

fn cors_headers(headers: &mut HeaderMap) {
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".parse().unwrap());
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        "GET, OPTIONS, HEAD".parse().unwrap(),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        "Range".parse().unwrap(),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        "Content-Range, Content-Length, Accept-Ranges"
            .parse()
            .unwrap(),
    );
}

fn error_response(status: StatusCode, message: String) -> Response<Body> {
    let mut response = Response::builder()
        .status(status)
        .body(Body::from(message))
        .unwrap();
    cors_headers(response.headers_mut());
    response
}

#[derive(Clone)]
struct ServerContext {
    client: Arc<Client>,
    downloads_dir: std::path::PathBuf,
}

async fn proxy_stream(
    State(ctx): State<ServerContext>,
    Path(encoded_url): Path<String>,
    headers: HeaderMap,
) -> Response<Body> {
    let client = &ctx.client;
    let url = match decode_stream_url(&encoded_url) {
        Ok(url) => url,
        Err(message) => {
            log::error!("[StreamServer] {message}");
            return error_response(StatusCode::BAD_REQUEST, message);
        }
    };

    log::debug!(
        "[StreamServer] Proxying request, range: {:?}",
        headers.get(header::RANGE)
    );

    let mut upstream_request = client.get(&url);
    if let Some(range_value) = headers.get(header::RANGE) {
        upstream_request = upstream_request.header(header::RANGE, range_value);
    }

    let upstream_response = match upstream_request.send().await {
        Ok(response) => response,
        Err(err) => {
            log::error!("[StreamServer] Request failed: {err:?}");
            return error_response(StatusCode::BAD_GATEWAY, format!("Failed to fetch: {err}"));
        }
    };

    let upstream_status = upstream_response.status();
    if !upstream_status.is_success() && upstream_status != StatusCode::PARTIAL_CONTENT {
        log::error!("[StreamServer] Streaming service returned: {upstream_status}");
        return error_response(
            StatusCode::from_u16(upstream_status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            format!("Streaming service returned error: {upstream_status}"),
        );
    }

    let upstream_headers = upstream_response.headers().clone();
    let body = Body::from_stream(upstream_response.bytes_stream());

    let mut response = Response::builder()
        .status(upstream_status.as_u16())
        .body(body)
        .unwrap();

    for name in FORWARD_HEADERS {
        if let Some(value) = upstream_headers.get(name) {
            response.headers_mut().insert(name, value.clone());
        }
    }

    cors_headers(response.headers_mut());
    response
}

async fn options_handler() -> Response<Body> {
    let mut response = Response::builder()
        .status(StatusCode::NO_CONTENT)
        .body(Body::empty())
        .unwrap();
    cors_headers(response.headers_mut());
    response
}

async fn serve_local_file(
    State(ctx): State<ServerContext>,
    Path(filename): Path<String>,
    headers: HeaderMap,
) -> Response<Body> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    let safe_name = std::path::Path::new(&filename)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if safe_name.is_empty() {
        return error_response(StatusCode::BAD_REQUEST, "Invalid filename".to_string());
    }

    let file_path = ctx.downloads_dir.join(safe_name);
    let mut file = match tokio::fs::File::open(&file_path).await {
        Ok(f) => f,
        Err(_) => return error_response(StatusCode::NOT_FOUND, "File not found".to_string()),
    };

    let meta = match file.metadata().await {
        Ok(m) => m,
        Err(_) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Metadata error".to_string()),
    };
    let total_len = meta.len();
    if total_len == 0 {
        return error_response(StatusCode::NOT_FOUND, "Empty file".to_string());
    }

    let content_type = if safe_name.ends_with(".webm") {
        "audio/webm"
    } else if safe_name.ends_with(".mp3") {
        "audio/mpeg"
    } else {
        "audio/mp4"
    };

    if let Some(range_hdr) = headers.get(header::RANGE).and_then(|h| h.to_str().ok()) {
        if let Some(range_spec) = range_hdr.strip_prefix("bytes=") {
            let mut parts = range_spec.splitn(2, '-');
            let start = parts
                .next()
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0)
                .min(total_len.saturating_sub(1));
            let end = parts
                .next()
                .and_then(|s| if s.is_empty() { None } else { s.parse::<u64>().ok() })
                .unwrap_or(total_len - 1)
                .min(total_len - 1);

            if start <= end {
                let chunk_len = end - start + 1;
                let _ = file.seek(std::io::SeekFrom::Start(start)).await;
                let mut buf = vec![0u8; chunk_len as usize];
                if file.read_exact(&mut buf).await.is_ok() {
                    let mut resp = Response::builder()
                        .status(StatusCode::PARTIAL_CONTENT)
                        .header(header::CONTENT_TYPE, content_type)
                        .header(header::ACCEPT_RANGES, "bytes")
                        .header(header::CONTENT_LENGTH, chunk_len.to_string())
                        .header(
                            header::CONTENT_RANGE,
                            format!("bytes {start}-{end}/{total_len}"),
                        )
                        .body(Body::from(buf))
                        .unwrap();
                    cors_headers(resp.headers_mut());
                    return resp;
                }
            }
        }
    }

    let mut buf = Vec::with_capacity(total_len as usize);
    if file.read_to_end(&mut buf).await.is_err() {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, "Read error".to_string());
    }

    let mut resp = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, total_len.to_string())
        .body(Body::from(buf))
        .unwrap();
    cors_headers(resp.headers_mut());
    resp
}

async fn start_server(ctx: ServerContext, ready: oneshot::Sender<Result<u16, String>>) {
    let cancellation_token = CancellationToken::new();

    let router = axum::Router::new()
        .route(
            "/stream/{encoded_url}",
            get(proxy_stream).options(options_handler),
        )
        .route(
            "/local/{filename}",
            get(serve_local_file).options(options_handler),
        )
        .with_state(ctx);

    let tcp_listener =
        match crate::net::bind_first_available_port("127.0.0.1", PORT_START, PORT_END).await {
            Ok(listener) => listener,
            Err(message) => {
                log::error!("Failed to bind stream server: {message}");
                let _ = ready.send(Err(message));
                return;
            }
        };

    let bound_port = tcp_listener.local_addr().unwrap().port();
    log::info!("Stream proxy listening on http://127.0.0.1:{bound_port}");
    let _ = ready.send(Ok(bound_port));

    let _ = axum::serve(tcp_listener, router)
        .with_graceful_shutdown(async move {
            cancellation_token.cancelled().await;
        })
        .await;

    log::info!("Stream server stopped");
}

pub fn init_stream_server(app_handle: AppHandle) {
    let client = Arc::new(
        crate::net::http_client_builder()
            .user_agent(USER_AGENT)
            .read_timeout(Duration::from_secs(300))
            .connect_timeout(Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client for stream server"),
    );

    let downloads_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("/tmp"))
        .join("downloads");
    let _ = std::fs::create_dir_all(&downloads_dir);

    let (ready_tx, ready_rx) = oneshot::channel();
    tauri::async_runtime::spawn(start_server(
        ServerContext {
            client,
            downloads_dir,
        },
        ready_tx,
    ));

    let handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        match ready_rx.await {
            Ok(Ok(port)) => {
                log::info!("Stream server ready on port {port}");
                handle.manage(StreamServerState { port });
            }
            Ok(Err(message)) => {
                log::error!("Stream server failed to start: {message}");
            }
            Err(_) => {
                log::error!("Stream server task exited before reporting ready");
            }
        }
    });
}

#[tauri::command]
#[specta::specta]
pub fn stream_server_port(state: tauri::State<'_, StreamServerState>) -> u16 {
    state.port
}

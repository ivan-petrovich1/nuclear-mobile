use std::net::{SocketAddr, UdpSocket};
use std::sync::Arc;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock;

const PORT_START: u16 = 37371;
const PORT_END: u16 = 37380;

#[derive(Clone)]
struct InnerPeerState {
    enabled: bool,
    pin: String,
    device_name: String,
    snapshot_json: String,
    playback_json: String,
}

#[derive(Clone)]
pub struct P2pSyncState {
    port: u16,
    app: AppHandle,
    inner: Arc<RwLock<InnerPeerState>>,
}

#[derive(Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct P2pPeerInfo {
    pub ip: String,
    pub port: u16,
    pub pin: String,
    pub enabled: bool,
    pub device_name: String,
}

fn detect_lan_ip() -> String {
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = sock.local_addr() {
                return addr.ip().to_string();
            }
        }
    }
    "127.0.0.1".to_string()
}

fn default_device_name() -> String {
    #[cfg(target_os = "android")]
    {
        return "Android Phone".to_string();
    }
    #[cfg(not(target_os = "android"))]
    {
        std::env::var("HOSTNAME")
            .or_else(|_| std::env::var("COMPUTERNAME"))
            .unwrap_or_else(|_| "Nuclear Desktop".to_string())
    }
}

async fn handle_ping(State(state): State<P2pSyncState>) -> Json<Value> {
    let inner = state.inner.read().await;
    Json(json!({
        "app": "nuclear-p2p",
        "enabled": inner.enabled,
        "deviceName": inner.device_name,
        "port": state.port
    }))
}

async fn handle_exchange(
    State(state): State<P2pSyncState>,
    headers: HeaderMap,
    body: String,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    let provided_pin = headers
        .get("x-nuclear-pin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim()
        .to_string();

    let local_snapshot = {
        let inner = state.inner.read().await;
        if !inner.enabled {
            return Err((
                StatusCode::FORBIDDEN,
                "Peer sync is disabled on this device".to_string(),
            ));
        }
        if inner.pin.is_empty() || inner.pin != provided_pin {
            return Err((StatusCode::UNAUTHORIZED, "Invalid pairing PIN".to_string()));
        }
        inner.snapshot_json.clone()
    };

    // Validate incoming JSON before emitting to frontend
    if serde_json::from_str::<Value>(&body).is_err() {
        return Err((StatusCode::BAD_REQUEST, "Invalid snapshot JSON".to_string()));
    }

    // Notify this device's frontend to merge the incoming peer snapshot
    let _ = state.app.emit("p2p-sync-incoming", body);

    Ok((StatusCode::OK, local_snapshot))
}

async fn handle_handoff(
    State(state): State<P2pSyncState>,
    headers: HeaderMap,
    body: String,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    let provided_pin = headers
        .get("x-nuclear-pin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim()
        .to_string();

    {
        let inner = state.inner.read().await;
        if !inner.enabled {
            return Err((
                StatusCode::FORBIDDEN,
                "Peer sync is disabled on this device".to_string(),
            ));
        }
        if inner.pin.is_empty() || inner.pin != provided_pin {
            return Err((StatusCode::UNAUTHORIZED, "Invalid pairing PIN".to_string()));
        }
    }

    if serde_json::from_str::<Value>(&body).is_err() {
        return Err((StatusCode::BAD_REQUEST, "Invalid handoff JSON".to_string()));
    }

    let _ = state.app.emit("p2p-handoff-incoming", body);
    Ok((StatusCode::OK, "{\"ok\":true}".to_string()))
}

async fn verify_pin(
    state: &P2pSyncState,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, String)> {
    let provided_pin = headers
        .get("x-nuclear-pin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim()
        .to_string();
    let inner = state.inner.read().await;
    if !inner.enabled {
        return Err((
            StatusCode::FORBIDDEN,
            "Peer sync is disabled on this device".to_string(),
        ));
    }
    if inner.pin.is_empty() || inner.pin != provided_pin {
        return Err((StatusCode::UNAUTHORIZED, "Invalid pairing PIN".to_string()));
    }
    Ok(())
}

async fn handle_state(
    State(state): State<P2pSyncState>,
    headers: HeaderMap,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    verify_pin(&state, &headers).await?;
    let inner = state.inner.read().await;
    Ok((StatusCode::OK, inner.playback_json.clone()))
}

async fn handle_control(
    State(state): State<P2pSyncState>,
    headers: HeaderMap,
    body: String,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    verify_pin(&state, &headers).await?;
    if serde_json::from_str::<Value>(&body).is_err() {
        return Err((StatusCode::BAD_REQUEST, "Invalid control JSON".to_string()));
    }
    let _ = state.app.emit("p2p-remote-control", body);
    Ok((StatusCode::OK, "{\"ok\":true}".to_string()))
}

async fn handle_pull_handoff(
    State(state): State<P2pSyncState>,
    headers: HeaderMap,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    verify_pin(&state, &headers).await?;
    let payload = {
        let inner = state.inner.read().await;
        inner.playback_json.clone()
    };
    let _ = state.app.emit("p2p-handoff-pause", "pull");
    Ok((StatusCode::OK, payload))
}

pub fn init_p2p_sync(app: AppHandle) {
    let device_name = default_device_name();
    let inner = Arc::new(RwLock::new(InnerPeerState {
        enabled: true,
        pin: "424242".to_string(),
        device_name,
        snapshot_json: "{}".to_string(),
        playback_json: "{}".to_string(),
    }));

    let (tx, rx) = std::sync::mpsc::channel::<u16>();
    let app_clone = app.clone();
    let inner_clone = inner.clone();

    tauri::async_runtime::spawn(async move {
        let mut bound_listener = None;
        let mut bound_port = 0u16;

        for port in PORT_START..=PORT_END {
            let addr = SocketAddr::from(([0, 0, 0, 0], port));
            if let Ok(listener) = tokio::net::TcpListener::bind(addr).await {
                bound_listener = Some(listener);
                bound_port = port;
                break;
            }
        }

        let _ = tx.send(bound_port);

        if let Some(listener) = bound_listener {
            let router_state = P2pSyncState {
                port: bound_port,
                app: app_clone,
                inner: inner_clone,
            };
            let router = Router::new()
                .route("/api/p2p/ping", get(handle_ping))
                .route("/api/p2p/exchange", post(handle_exchange))
                .route("/api/p2p/handoff", post(handle_handoff))
                .route("/api/p2p/state", get(handle_state))
                .route("/api/p2p/control", post(handle_control))
                .route("/api/p2p/pull-handoff", post(handle_pull_handoff))
                .with_state(router_state);

            let _ = axum::serve(listener, router).await;
        }
    });

    let port = rx.recv().unwrap_or(0);
    app.manage(P2pSyncState { port, app: app.clone(), inner });
}

#[tauri::command]
#[specta::specta]
pub async fn p2p_sync_info(
    state: tauri::State<'_, P2pSyncState>,
) -> Result<P2pPeerInfo, String> {
    let inner = state.inner.read().await;
    Ok(P2pPeerInfo {
        ip: detect_lan_ip(),
        port: state.port,
        pin: inner.pin.clone(),
        enabled: inner.enabled,
        device_name: inner.device_name.clone(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn p2p_sync_configure(
    state: tauri::State<'_, P2pSyncState>,
    enabled: bool,
    pin: String,
) -> Result<(), String> {
    let mut inner = state.inner.write().await;
    inner.enabled = enabled;
    let trimmed = pin.trim();
    if !trimmed.is_empty() {
        inner.pin = trimmed.to_string();
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn p2p_sync_update_snapshot(
    state: tauri::State<'_, P2pSyncState>,
    snapshot_json: String,
) -> Result<(), String> {
    let mut inner = state.inner.write().await;
    inner.snapshot_json = snapshot_json;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn p2p_sync_update_playback(
    state: tauri::State<'_, P2pSyncState>,
    playback_json: String,
) -> Result<(), String> {
    let mut inner = state.inner.write().await;
    inner.playback_json = playback_json;
    Ok(())
}

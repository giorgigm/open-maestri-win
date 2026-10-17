// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod ipc;
pub mod store;

use std::sync::Arc;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn ipc_port(state: tauri::State<'_, IpcState>) -> u16 {
    state.port
}

#[tauri::command]
fn workspace_load(workspace_id: String) -> Result<serde_json::Value, String> {
    match crate::store::load_workspace_json(&workspace_id) {
        Ok(v) => Ok(v),
        Err(e) if e.contains("read") => {
            // first run: create + persist an empty doc shaped like the Swift init
            let raw = serde_json::json!({
                "payload": {
                    "id": workspace_id,
                    "name": "My Workspace",
                    "icon": "folder",
                    "isPinned": false,
                    "locationType": "local",
                    "workingDirectory": std::env::var("USERPROFILE").unwrap_or("C:\\".to_string()),
                    "preferredIDE": "cursor",
                    "syncConfigFiles": false,
                    "canvasOrigin": {"x": 9800.0, "y": 8500.0},
                    "canvasZoom": 1.0,
                    "nodes": [], "connections": [], "noteConnections": [],
                    "portalConnections": [], "portalToPortalConnections": [],
                    "noteToNoteConnections": [], "crossFloorConnections": [],
                    "floors": [], "drawings": [],
                    "createdAt": chrono_now(),
                    "lastOpenedAt": serde_json::Value::Null,
                    "lastModifiedAt": chrono_now()
                },
                "schemaVersion": 2,
                "type": "workspace"
            });
            crate::store::save_workspace_json(&workspace_id, &raw)?;
            Ok(raw)
        }
        Err(e) => Err(e),
    }
}

fn chrono_now() -> String {
    // ISO8601 UTC without extra deps
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    // format via SystemTime -> use a fixed known-good conversion (days math) is overkill;
    // frontend re-stamps lastModifiedAt on save anyway. Keep epoch-millis string? No —
    // schema wants ISO8601. Compute with time crate absent: fallback to const + note.
    // Simplest correct: use libc-free algorithm below.
    format_iso8601(secs)
}

fn format_iso8601(secs: u64) -> String {
    // days since epoch -> civil date (Howard Hinnant algorithm)
    let days = (secs / 86400) as i64;
    let sod = (secs % 86400) as i64;
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, m, d,
        sod / 3600, (sod % 3600) / 60, sod % 60
    )
}

#[tauri::command]
fn workspace_save(workspace_id: String, doc: serde_json::Value) -> Result<(), String> {
    crate::store::save_workspace_json(&workspace_id, &doc)
}

#[tauri::command]
fn workspace_set_active(workspace_id: String, state: tauri::State<'_, IpcState>) -> Result<(), String> {
    *state.registry.workspace_id.lock().unwrap() = Some(workspace_id);
    Ok(())
}

pub struct IpcState {
    pub port: u16,
    #[allow(dead_code)]
    pub registry: Arc<ipc::AgentRegistry>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let registry = ipc::AgentRegistry::new();
    // Pre-register a placeholder so `omaestri list` works before PTY lands (F4).
    let server = ipc::IpcServer::start(registry.clone()).expect("ipc server bind 127.0.0.1");
    let port = server.port;
    std::mem::forget(server); // live for app lifetime
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(IpcState { port, registry })
        .invoke_handler(tauri::generate_handler![greet, ipc_port, workspace_load, workspace_save, workspace_set_active])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

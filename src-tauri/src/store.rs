//! App data paths + atomic workspace.json persistence.
//!
//! Mirrors Sources/Workspace/PersistenceManager.swift:
//! root `<base>/workspaces/{uuid}/workspace.json`, notes/, terminals/*.scrollback.
//! Base dir resolution: %APPDATA%\open-maestri on Windows (paridade: $HOME/.open-maestri
//! via OPEN_MAESTRI_DATA_DIR override).

use std::path::{Path, PathBuf};

/// Base data directory. Override with `OPEN_MAESTRI_DATA_DIR` (tests/dev).
pub fn app_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("OPEN_MAESTRI_DATA_DIR") {
        return PathBuf::from(dir);
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join("open-maestri");
        }
    }
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".open-maestri")
}

pub fn workspace_dir(workspace_id: &str) -> PathBuf {
    app_data_dir().join("workspaces").join(workspace_id)
}

pub fn workspace_file(workspace_id: &str) -> PathBuf {
    workspace_dir(workspace_id).join("workspace.json")
}

pub fn notes_dir(workspace_id: &str) -> PathBuf {
    workspace_dir(workspace_id).join("notes")
}

pub fn terminals_dir(workspace_id: &str) -> PathBuf {
    workspace_dir(workspace_id).join("terminals")
}

pub fn ensure_workspace_dirs(workspace_id: &str) -> std::io::Result<()> {
    for dir in [
        workspace_dir(workspace_id),
        notes_dir(workspace_id),
        terminals_dir(workspace_id),
        app_data_dir().join("run"),
    ] {
        std::fs::create_dir_all(&dir)?;
    }
    Ok(())
}

/// Atomic write: `<path>.tmp` + rename (mirrors PersistenceManager.atomicWrite
/// which uses .tmp + replaceItem; rename on same volume is atomic on Windows).
pub fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Validate envelope minimally (schemaVersion + type + payload object) and
/// persist pretty JSON. Full schema validation lives in TS (`workspace-schema.ts`).
pub fn save_workspace_json(workspace_id: &str, raw: &serde_json::Value) -> Result<(), String> {
    let version = raw.get("schemaVersion").and_then(|v| v.as_u64());
    if version != Some(2) {
        return Err(format!(
            "error: unsupported schemaVersion (want 2, got {:?})",
            raw.get("schemaVersion")
        ));
    }
    if raw.get("type").and_then(|t| t.as_str()) != Some("workspace") {
        return Err("error: invalid workspace document (type != workspace)".to_string());
    }
    if !raw.get("payload").map(|p| p.is_object()).unwrap_or(false) {
        return Err("error: invalid workspace document (missing payload)".to_string());
    }
    let pretty = serde_json::to_vec_pretty(raw).map_err(|e| format!("error: encode: {e}"))?;
    ensure_workspace_dirs(workspace_id).map_err(|e| format!("error: mkdir: {e}"))?;
    atomic_write(&workspace_file(workspace_id), &pretty).map_err(|e| format!("error: write: {e}"))?;
    Ok(())
}

pub fn load_workspace_json(workspace_id: &str) -> Result<serde_json::Value, String> {
    let bytes =
        std::fs::read(workspace_file(workspace_id)).map_err(|e| format!("error: read: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("error: parse: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("omw-store-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        unsafe { std::env::set_var("OPEN_MAESTRI_DATA_DIR", &dir) };
        dir
    }

    #[test]
    fn roundtrip_workspace_json() {
        let _dir = test_dir("roundtrip");
        let ws = "00000000-0000-0000-0000-000000000001";
        let raw: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/TestWorkspace.json"
        ))
        .unwrap();
        save_workspace_json(ws, &raw).unwrap();
        assert!(workspace_file(ws).exists());
        // no .tmp residue after atomic rename
        assert!(!workspace_dir(ws).join("workspace.json.tmp").exists());
        let back = load_workspace_json(ws).unwrap();
        assert_eq!(back["schemaVersion"], 2);
        assert_eq!(back["payload"]["name"], "Test Workspace");
    }

    #[test]
    fn rejects_bad_envelope() {
        let _dir = test_dir("reject");
        let ws = "ws-bad";
        let bad = serde_json::json!({"schemaVersion": 1, "type": "workspace", "payload": {}});
        assert!(save_workspace_json(ws, &bad).is_err());
        let bad2 = serde_json::json!({"schemaVersion": 2, "type": "nope", "payload": {}});
        assert!(save_workspace_json(ws, &bad2).is_err());
    }
}

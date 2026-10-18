//! manifest.json / sidebar-layout.json / app-state.json persistence.
//!
//! Mirrors Sources/Workspace/Models/AppState+Models.swift (WorkspaceManifest,
//! WorkspaceEntry, AppStateData) + Sources/Workspace/SidebarLayout.swift.
//! All writes go through store::atomic_write.

use serde::{Deserialize, Serialize};

fn default_color() -> String {
    "blue".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    pub id: String,
    pub name: String,
    pub working_directory: String,
    pub icon: String,
    #[serde(default = "default_color")]
    pub color: String,
    pub is_pinned: bool,
    pub location_type: String,
    pub created_at: String,
    pub last_opened_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceManifest {
    pub schema_version: u32,
    #[serde(rename = "type")]
    pub doc_type: String,
    pub app: String,
    pub app_version: String,
    pub data_format: u32,
    pub workspaces: Vec<WorkspaceEntry>,
    pub files: std::collections::HashMap<String, String>,
}

impl Default for WorkspaceManifest {
    fn default() -> Self {
        Self {
            schema_version: 1,
            doc_type: "appState".to_string(),
            app: "open-maestri".to_string(),
            app_version: "1.0.0".to_string(),
            data_format: 2,
            workspaces: vec![],
            files: Default::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SidebarGroup {
    pub id: String,
    pub name: String,
    pub is_collapsed: bool,
    pub items: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SidebarLayout {
    pub schema_version: u32,
    pub top_level_items: Vec<String>,
    pub groups: Vec<SidebarGroup>,
}

impl Default for SidebarLayout {
    fn default() -> Self {
        Self { schema_version: 2, top_level_items: vec![], groups: vec![] }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppStateData {
    pub schema_version: u32,
    #[serde(rename = "type")]
    pub doc_type: String,
    pub active_workspace_id: Option<String>,
    pub has_completed_onboarding: bool,
    pub has_seen_floor_onboarding: bool,
    pub clean_shutdown: bool,
    pub last_opened_at: Option<String>,
    pub recent_workspace_ids: Vec<String>,
}

impl Default for AppStateData {
    fn default() -> Self {
        Self {
            schema_version: 1,
            doc_type: "appState".to_string(),
            active_workspace_id: None,
            has_completed_onboarding: false,
            has_seen_floor_onboarding: false,
            clean_shutdown: true,
            last_opened_at: None,
            recent_workspace_ids: vec![],
        }
    }
}

fn manifest_path() -> std::path::PathBuf {
    crate::store::app_data_dir().join("manifest.json")
}
fn sidebar_path() -> std::path::PathBuf {
    crate::store::app_data_dir().join("sidebar-layout.json")
}
fn app_state_path() -> std::path::PathBuf {
    crate::store::app_data_dir().join("app-state.json")
}

fn load_or_default<T>(path: &std::path::Path) -> Result<T, String>
where
    T: Default + for<'de> Deserialize<'de>,
{
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("error: parse: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(format!("error: read: {e}")),
    }
}

fn save<T>(path: &std::path::Path, value: &T) -> Result<(), String>
where
    T: Serialize,
{
    let pretty = serde_json::to_vec_pretty(value).map_err(|e| format!("error: encode: {e}"))?;
    crate::store::atomic_write(path, &pretty).map_err(|e| format!("error: write: {e}"))
}

// ------------------------------------------------------------------ commands

#[tauri::command]
pub fn manifest_load() -> Result<WorkspaceManifest, String> {
    load_or_default(&manifest_path())
}

#[tauri::command]
pub fn manifest_save(manifest: WorkspaceManifest) -> Result<(), String> {
    save(&manifest_path(), &manifest)
}

#[tauri::command]
pub fn sidebar_load() -> Result<SidebarLayout, String> {
    load_or_default(&sidebar_path())
}

#[tauri::command]
pub fn sidebar_save(layout: SidebarLayout) -> Result<(), String> {
    save(&sidebar_path(), &layout)
}

#[tauri::command]
pub fn appstate_load() -> Result<AppStateData, String> {
    load_or_default(&app_state_path())
}

#[tauri::command]
pub fn appstate_save(state: AppStateData) -> Result<(), String> {
    save(&app_state_path(), &state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) {
        let dir = std::env::temp_dir().join(format!("omw-manifest-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        unsafe { std::env::set_var("OPEN_MAESTRI_DATA_DIR", &dir) };
    }

    #[test]
    fn defaults_match_swift_init() {
        test_dir("defaults");
        let m: WorkspaceManifest = load_or_default(&manifest_path()).unwrap();
        assert_eq!(m.schema_version, 1);
        assert_eq!(m.doc_type, "appState");
        assert_eq!(m.app, "open-maestri");
        assert_eq!(m.data_format, 2);
        assert!(m.workspaces.is_empty());
        let s: SidebarLayout = load_or_default(&sidebar_path()).unwrap();
        assert_eq!(s.schema_version, 2);
        let a: AppStateData = load_or_default(&app_state_path()).unwrap();
        assert!(a.clean_shutdown);
        assert!(!a.has_completed_onboarding);
    }

    #[test]
    fn roundtrip_and_legacy_tolerance() {
        test_dir("roundtrip");
        // legacy entry without `color` -> "blue" (mirrors Swift decodeIfPresent)
        let legacy = serde_json::json!([{
            "id": "w1", "name": "W", "workingDirectory": "C:\\x",
            "icon": "folder", "isPinned": false, "locationType": "local",
            "createdAt": "2026-01-01T00:00:00Z", "lastOpenedAt": null
        }]);
        let entries: Vec<WorkspaceEntry> = serde_json::from_value(legacy).unwrap();
        assert_eq!(entries[0].color, "blue");
        let mut m = WorkspaceManifest::default();
        m.workspaces = entries;
        manifest_save(m.clone()).unwrap();
        let back = manifest_load().unwrap();
        assert_eq!(back, m);
        assert!(manifest_path().exists());

        let layout = SidebarLayout {
            schema_version: 2,
            top_level_items: vec!["w1".to_string()],
            groups: vec![SidebarGroup {
                id: "g1".to_string(),
                name: "Work".to_string(),
                is_collapsed: false,
                items: vec![],
            }],
        };
        sidebar_save(layout.clone()).unwrap();
        assert_eq!(sidebar_load().unwrap(), layout);

        let state = AppStateData { active_workspace_id: Some("w1".to_string()), ..Default::default() };
        appstate_save(state.clone()).unwrap();
        assert_eq!(appstate_load().unwrap(), state);
    }
}

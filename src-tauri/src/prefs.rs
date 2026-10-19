//! preferences.json — mirrors Preferences.swift (22 fields), Windows-adapted.
//! Missing fields decode to Swift defaults (tolerant decode).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPresetCfg {
    pub id: String,
    pub name: String,
    pub command: String,
    pub icon: String,
    pub agent_type: String,
    pub color: String,
    pub is_active: bool,
    pub is_built_in: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RolePresetCfg {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub color: String,
    pub icon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyBinding {
    pub command: bool,
    pub control: bool,
    pub option: bool,
    pub shift: bool,
    pub key_code: String,
}

fn kb(cmd: bool, ctrl: bool, opt: bool, shift: bool, code: &str) -> KeyBinding {
    KeyBinding { command: cmd, control: ctrl, option: opt, shift: shift, key_code: code.to_string() }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutConfig {
    pub custom_keys: HashMap<String, String>,
    pub node_jump_modifier: KeyBinding,
    pub connect_shortcut: KeyBinding,
    pub next_terminal_shortcut: KeyBinding,
    pub prev_terminal_shortcut: KeyBinding,
    pub next_workspace_shortcut: KeyBinding,
    pub prev_workspace_shortcut: KeyBinding,
    pub workspace_jump_modifier: KeyBinding,
    pub zoom_toggle_shortcut: KeyBinding,
    pub zoom_scroll_modifier: KeyBinding,
    pub scroll_switch_modifier: KeyBinding,
    pub tile_modifier: KeyBinding,
    pub pan_toggle_shortcut: KeyBinding,
    pub auto_scroll_lock_shortcut: KeyBinding,
    pub floor_overview_shortcut: KeyBinding,
    pub filter_shortcut: KeyBinding,
}

impl Default for ShortcutConfig {
    fn default() -> Self {
        Self {
            custom_keys: HashMap::new(),
            // Windows: command->control mapping for jump/connect/workspace modifiers
            node_jump_modifier: kb(false, true, false, false, "control"),
            connect_shortcut: kb(false, false, false, false, "l"),
            next_terminal_shortcut: kb(false, true, false, false, "tab"),
            prev_terminal_shortcut: kb(false, true, false, true, "tab"),
            next_workspace_shortcut: kb(false, true, false, false, "arrowdown"),
            prev_workspace_shortcut: kb(false, true, false, false, "arrowup"),
            workspace_jump_modifier: kb(false, true, false, false, "control"),
            zoom_toggle_shortcut: kb(false, false, false, false, "backslash"),
            zoom_scroll_modifier: kb(false, true, false, false, "control"),
            scroll_switch_modifier: kb(false, true, false, false, "control"),
            tile_modifier: kb(false, false, false, true, "m"),
            pan_toggle_shortcut: kb(false, false, false, false, "h"),
            auto_scroll_lock_shortcut: kb(false, true, false, true, "b"),
            floor_overview_shortcut: kb(false, true, false, true, "backslash"),
            filter_shortcut: kb(false, false, false, false, "p"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub schema_version: u32,
    pub agent_presets: Vec<AgentPresetCfg>,
    pub role_presets: Vec<RolePresetCfg>,
    pub terminal_font_family: String,
    pub terminal_font_size: f64,
    pub terminal_theme: String,
    pub canvas_background: String,
    pub default_note_color: String,
    pub preferred_ide: String,
    pub language: String,
    pub shortcuts: ShortcutConfig,
    pub ssh_enabled: bool,
    pub ssh_tunnel_port: u16,
    pub ssh_host: String,
    pub ssh_user: String,
    pub ssh_port: u16,
    pub scrollback_memory_limit: bool,
    pub autosave_interval_seconds: u64,
}

fn uuid() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}", n)
}

impl Default for Preferences {
    fn default() -> Self {
        let preset = |id: &str, name: &str, command: &str, icon: &str, at: &str, color: &str| AgentPresetCfg {
            id: id.to_string(),
            name: name.to_string(),
            command: command.to_string(),
            icon: icon.to_string(),
            agent_type: at.to_string(),
            color: color.to_string(),
            is_active: true,
            is_built_in: true,
        };
        Self {
            schema_version: 1,
            agent_presets: vec![
                preset("claude-code", "Claude Code", "claude", "seal", "claude_code", "#007AFF"),
                preset("codex", "Codex", "codex", "brain", "codex", "#5856D6"),
                preset("gemini", "Gemini CLI", "gemini", "sparkle", "gemini_cli", "#34C759"),
                preset("opencode", "OpenCode", "opencode", "rect", "open_code", "#FF9500"),
                preset("shell", "Shell", "", "terminal", "generic_shell", "#8E8E93"),
            ],
            role_presets: vec![],
            terminal_font_family: "system".to_string(),
            terminal_font_size: 13.0,
            terminal_theme: "dark".to_string(),
            canvas_background: "dotGrid".to_string(),
            default_note_color: "#FEFDE8".to_string(),
            preferred_ide: "cursor".to_string(),
            language: "en".to_string(),
            shortcuts: ShortcutConfig::default(),
            ssh_enabled: false,
            ssh_tunnel_port: 7433,
            ssh_host: String::new(),
            ssh_user: String::new(),
            ssh_port: 22,
            scrollback_memory_limit: false,
            autosave_interval_seconds: 30,
        }
    }
}

fn prefs_path() -> std::path::PathBuf {
    crate::store::app_data_dir().join("preferences.json")
}

#[tauri::command]
pub fn prefs_load() -> Result<Preferences, String> {
    match std::fs::read(prefs_path()) {
        Ok(bytes) => {
            // tolerant: missing fields -> defaults via serde(default) chain below
            let mut v: serde_json::Value =
                serde_json::from_slice(&bytes).map_err(|e| format!("error: parse: {e}"))?;
            let def = serde_json::to_value(Preferences::default()).unwrap();
            merge_defaults(&mut v, &def);
            serde_json::from_value(v).map_err(|e| format!("error: decode: {e}"))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Preferences::default()),
        Err(e) => Err(format!("error: read: {e}")),
    }
}

fn merge_defaults(v: &mut serde_json::Value, def: &serde_json::Value) {
    if let (Some vo), Some(do_)) = (v.as_object_mut(), def.as_object()) {
        for (k, dv) in do_ {
            match vo.get_mut(k) {
                Some(ev) => {
                    if ev.is_object() && dv.is_object() {
                        merge_defaults(ev, dv);
                    } else if ev.is_null() {
                        *ev = dv.clone();
                    }
                }
                None => {
                    vo.insert(k.clone(), dv.clone());
                }
            }
        }
    }
}

#[tauri::command]
pub fn prefs_save(prefs: Preferences) -> Result<(), String> {
    let pretty = serde_json::to_vec_pretty(&prefs).map_err(|e| format!("error: encode: {e}"))?;
    crate::store::atomic_write(&prefs_path(), &pretty).map_err(|e| format!("error: write: {e}"))
}

#[tauri::command]
pub fn data_dir_open() -> Result<(), String> {
    // opener plugin handles it frontend-side; keep command for parity/tests
    Ok(())
}

#[tauri::command]
pub fn app_reset(confirm: String) -> Result<(), String> {
    if confirm != "DELETE" {
        return Err("error: type DELETE to confirm".to_string());
    }
    let dir = crate::store::app_data_dir();
    for entry in ["manifest.json", "sidebar-layout.json", "app-state.json", "preferences.json", "routines.json"] {
        let _ = std::fs::remove_file(dir.join(entry));
    }
    let _ = std::fs::remove_dir_all(dir.join("workspaces"));
    let _ = uuid(); // keep helper live
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_swift() {
        let p = Preferences::default();
        assert_eq!(p.schema_version, 1);
        assert_eq!(p.agent_presets.len(), 5);
        assert_eq!(p.terminal_font_size, 13.0);
        assert_eq!(p.terminal_theme, "dark");
        assert_eq!(p.autosave_interval_seconds, 30);
        assert_eq!(p.ssh_tunnel_port, 7433);
        // Windows: no metalRenderer/optionAsMeta/xcode by design
    }

    #[test]
    fn legacy_empty_decodes_to_defaults() {
        let mut v = serde_json::json!({});
        let def = serde_json::to_value(Preferences::default()).unwrap();
        merge_defaults(&mut v, &def);
        let p: Preferences = serde_json::from_value(v).unwrap();
        assert_eq!(p.language, "en");
        assert_eq!(p.agent_presets.len(), 5);
    }
}

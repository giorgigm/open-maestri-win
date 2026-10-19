//! Floors (git worktree) + Routines (scheduled prompts) + SSH config (prefs-backed).
//! Mirrors FloorManager.swift + RoutineScheduler.swift at Mac-partial scope.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FloorHooks {
    pub setup: Vec<String>,
    pub run: Vec<String>,
    pub teardown: Vec<String>,
    pub auto_run_setup: bool,
}

impl Default for FloorHooks {
    fn default() -> Self {
        Self { setup: vec![], run: vec![], teardown: vec![], auto_run_setup: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FloorEntry {
    pub id: String,
    pub name: String,
    pub branch_name: String,
    pub worktree_path: String,
    pub hooks: FloorHooks,
    pub created_at: String,
}

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    // reuse the civil-date formatter from lib via store-independent code
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
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, m, d, sod / 3600, (sod % 3600) / 60, sod % 60)
}

fn git(root: &str, args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|e| format!("error: git not available: {e}"))?;
    if !out.status.success() {
        return Err(format!("error: git {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn read_floors(workspace_id: &str) -> Result<(serde_json::Value, Vec<FloorEntry>), String> {
    let doc = crate::store::load_workspace_json(workspace_id)?;
    let arr = doc
        .get("payload")
        .and_then(|p| p.get("floors"))
        .and_then(|f| f.as_array())
        .cloned()
        .unwrap_or_default();
    let floors: Vec<FloorEntry> =
        serde_json::from_value(serde_json::Value::Array(arr)).unwrap_or_default();
    Ok((doc, floors))
}

fn write_floors(workspace_id: &str, mut doc: serde_json::Value, floors: &[FloorEntry]) -> Result<(), String> {
    if let Some(p) = doc.get_mut("payload") {
        p["floors"] = serde_json::to_value(floors).unwrap();
        p["lastModifiedAt"] = serde_json::Value::String(now_iso());
    }
    crate::store::save_workspace_json(workspace_id, &doc)
}

#[tauri::command]
pub fn floor_create(workspace_id: String, name: String, branch: String) -> Result<FloorEntry, String> {
    let doc = crate::store::load_workspace_json(&workspace_id)?;
    let root = doc
        .get("payload")
        .and_then(|p| p.get("workingDirectory"))
        .and_then(|w| w.as_str())
        .ok_or_else(|| "error: invalid workspace".to_string())?
        .to_string();
    if !std::path::Path::new(&format!("{root}/.git")).exists() {
        return Err(format!("error: not a git repo: {root}"));
    }
    let path = format!("{root}/.open-maestri/floors/{name}");
    git(&root, &["worktree", "add", "-b", &branch, &path])?;
    let (doc2, mut floors) = read_floors(&workspace_id)?;
    let entry = FloorEntry {
        id: uuid(),
        name,
        branch_name: branch,
        worktree_path: path,
        hooks: FloorHooks::default(),
        created_at: now_iso(),
    };
    floors.push(entry.clone());
    write_floors(&workspace_id, doc2, &floors)?;
    Ok(entry)
}

#[tauri::command]
pub fn floor_list(workspace_id: String) -> Result<Vec<FloorEntry>, String> {
    Ok(read_floors(&workspace_id)?.1)
}

#[tauri::command]
pub fn floor_remove(workspace_id: String, floor_id: String) -> Result<(), String> {
    let doc = crate::store::load_workspace_json(&workspace_id)?;
    let root = doc
        .get("payload")
        .and_then(|p| p.get("workingDirectory"))
        .and_then(|w| w.as_str())
        .unwrap_or("")
        .to_string();
    let (doc2, mut floors) = read_floors(&workspace_id)?;
    let Some(f) = floors.iter().find(|f| f.id == floor_id).cloned() else {
        return Err("error: floor not found".to_string());
    };
    if !root.is_empty() {
        let _ = git(&root, &["worktree", "remove", "--force", &f.worktree_path]);
    }
    floors.retain(|x| x.id != floor_id);
    write_floors(&workspace_id, doc2, &floors)
}

#[tauri::command]
pub fn floor_land(workspace_id: String, floor_id: String) -> Result<String, String> {
    let doc = crate::store::load_workspace_json(&workspace_id)?;
    let root = doc
        .get("payload")
        .and_then(|p| p.get("workingDirectory"))
        .and_then(|w| w.as_str())
        .ok_or_else(|| "error: invalid workspace".to_string())?
        .to_string();
    let (_, floors) = read_floors(&workspace_id)?;
    let Some(f) = floors.iter().find(|f| f.id == floor_id) else {
        return Err("error: floor not found".to_string());
    };
    git(&root, &["fetch", &f.worktree_path, &format!("{}:{}", f.branch_name, f.branch_name)])?;
    let out = git(&root, &["merge", &f.branch_name, "--no-ff", "-m", &format!("Landing: {}", f.name)])?;
    Ok(out.trim().to_string())
}

#[tauri::command]
pub fn floor_run_hooks(workspace_id: String, floor_id: String, phase: String) -> Result<String, String> {
    let doc = crate::store::load_workspace_json(&workspace_id)?;
    let root = doc
        .get("payload")
        .and_then(|p| p.get("workingDirectory"))
        .and_then(|w| w.as_str())
        .unwrap_or("")
        .to_string();
    let (_, floors) = read_floors(&workspace_id)?;
    let Some(f) = floors.iter().find(|f| f.id == floor_id) else {
        return Err("error: floor not found".to_string());
    };
    let hooks = match phase.as_str() {
        "setup" => &f.hooks.setup,
        "run" => &f.hooks.run,
        "teardown" => &f.hooks.teardown,
        _ => return Err("error: phase must be setup|run|teardown".to_string()),
    };
    let mut out = String::new();
    for h in hooks {
        let res = std::process::Command::new("powershell.exe")
            .args(["-NoLogo", "-Command", h])
            .current_dir(&f.worktree_path)
            .env("OMAESTRI_FLOOR_NAME", &f.name)
            .env("OMAESTRI_BRANCH_NAME", &f.branch_name)
            .env("OMAESTRI_FLOOR_PATH", &f.worktree_path)
            .env("OMAESTRI_ROOT_PATH", &root)
            .output()
            .map_err(|e| format!("error: hook: {e}"))?;
        out.push_str(&format!("$ {}\n{}\n", h, String::from_utf8_lossy(&res.stdout)));
    }
    Ok(out)
}

fn uuid() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| format!("{:x}", d.as_nanos()))
        .unwrap_or_else(|_| "0".to_string())
}

// ------------------------------------------------------------------ routines

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Routine {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub interval_seconds: u64,
    pub target_terminal_id: String,
    pub is_active: bool,
    pub created_at: String,
}

pub fn split_prompts(prompt: &str) -> Vec<String> {
    prompt.split("&&").map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
}

fn routines_path() -> std::path::PathBuf {
    crate::store::app_data_dir().join("routines.json")
}

fn load_routines() -> Vec<Routine> {
    let Ok(bytes) = std::fs::read(routines_path()) else { return vec![] };
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes) else { return vec![] };
    // compat: new {routines} or legacy Maestri {payload}
    if let Some(arr) = v.get("routines").and_then(|a| a.as_array()) {
        return serde_json::from_value(serde_json::Value::Array(arr.clone())).unwrap_or_default();
    }
    if let Some(arr) = v.get("payload").and_then(|a| a.as_array()) {
        return serde_json::from_value(serde_json::Value::Array(arr.clone())).unwrap_or_default();
    }
    vec![]
}

fn save_routines(list: &[Routine]) -> Result<(), String> {
    // write with `payload` key like the Mac (Maestri compat)
    let v = serde_json::json!({"payload": list});
    let pretty = serde_json::to_vec_pretty(&v).map_err(|e| format!("error: encode: {e}"))?;
    crate::store::atomic_write(&routines_path(), &pretty).map_err(|e| format!("error: write: {e}"))
}

#[tauri::command]
pub fn routine_list() -> Result<Vec<Routine>, String> {
    Ok(load_routines())
}

#[tauri::command]
pub fn routine_create(name: String, prompt: String, interval_seconds: u64, target_terminal_id: String) -> Result<Routine, String> {
    if interval_seconds < 60 {
        return Err("error: minimum interval is 60s".to_string());
    }
    if split_prompts(&prompt).is_empty() {
        return Err("error: prompt required".to_string());
    }
    let mut list = load_routines();
    let r = Routine {
        id: uuid(),
        name,
        prompt,
        interval_seconds,
        target_terminal_id,
        is_active: true,
        created_at: now_iso(),
    };
    list.push(r.clone());
    save_routines(&list)?;
    // spawn ticker thread (fires ask chain; stops after 3 consecutive errors)
    if let Some(pty) = crate::ipc::pty() {
        let prompts = split_prompts(&r.prompt);
        let tid = r.target_terminal_id.clone();
        let interval = r.interval_seconds;
        let rid = r.id.clone();
        std::thread::spawn(move || {
            let mut failures = 0u32;
            let mut idx = 0usize;
            loop {
                std::thread::sleep(std::time::Duration::from_secs(interval));
                // stop if routine paused/deleted
                let active = load_routines().iter().any(|x| x.id == rid && x.is_active);
                if !active {
                    break;
                }
                let prompt = &prompts[idx % prompts.len()];
                idx += 1;
                match pty.ask(&tid, prompt) {
                    Ok(_) => failures = 0,
                    Err(_) => {
                        failures += 1;
                        if failures >= 3 {
                            break;
                        }
                    }
                }
            }
        });
    }
    Ok(r)
}

#[tauri::command]
pub fn routine_set_active(id: String, active: bool) -> Result<(), String> {
    let mut list = load_routines();
    let Some(r) = list.iter_mut().find(|x| x.id == id) else {
        return Err("error: routine not found".to_string());
    };
    r.is_active = active;
    save_routines(&list)
}

#[tauri::command]
pub fn routine_delete(id: String) -> Result<(), String> {
    let mut list = load_routines();
    list.retain(|x| x.id != id);
    save_routines(&list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_chains_split() {
        assert_eq!(split_prompts("a && b &&c"), vec!["a", "b", "c"]);
        assert!(split_prompts("   ").is_empty());
    }

    #[test]
    fn routines_file_tolerates_both_keys() {
        let dir = std::env::temp_dir().join("omw-adv-test");
        let _ = std::fs::remove_dir_all(&dir);
        unsafe { std::env::set_var("OPEN_MAESTRI_DATA_DIR", &dir) };
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(routines_path(), r#"{"payload":[]}"#).unwrap();
        assert!(load_routines().is_empty());
        std::fs::write(routines_path(), r#"{"routines":[]}"#).unwrap();
        assert!(load_routines().is_empty());
    }
}

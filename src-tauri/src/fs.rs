//! File listing + git operations via system `git` CLI.
//! Mirrors FileTreeStateStore (lazy list) + GitStatusProvider/GitOperationsPanel (partial).

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileItem {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<String>,
}

fn guard_within(path: &Path, root: &Path) -> bool {
    path.starts_with(root)
}

#[tauri::command]
pub fn fs_list(path: String) -> Result<Vec<FileItem>, String> {
    let dir = Path::new(&path);
    let entries = std::fs::read_dir(dir).map_err(|e| format!("error: list: {e}"))?;
    let mut items = vec![];
    for e in entries.flatten() {
        let p = e.path();
        if p.file_name().and_then(|n| n.to_str()) == Some(".git") {
            continue;
        }
        let meta = e.metadata().ok();
        items.push(FileItem {
            name: e.file_name().to_string_lossy().to_string(),
            path: p.to_string_lossy().to_string(),
            is_dir: meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
            size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
            modified: meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| {
                    t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs().to_string())
                }),
        });
    }
    items.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(items)
}

fn git_run(root: &str, args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|e| format!("error: git not available: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(format!("error: git {}: {}", args.join(" "), if err.is_empty() { "failed" } else { &err }));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
pub fn git_status(root: String) -> Result<std::collections::HashMap<String, String>, String> {
    let out = git_run(&root, &["status", "--porcelain=v1", "-uall"])?;
    Ok(parse_porcelain(&out))
}

pub fn parse_porcelain(out: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for line in out.lines() {
        if line.len() < 4 {
            continue;
        }
        let code = line[..2].trim().to_string();
        let path = line[3..].trim();
        // rename "old -> new": key by new path
        let key = path.split(" -> ").last().unwrap_or(path).to_string();
        map.insert(key, if code.is_empty() { "?".to_string() } else { code });
    }
    map
}

#[tauri::command]
pub fn git_branch(root: String) -> Result<String, String> {
    Ok(git_run(&root, &["branch", "--show-current"])?.trim().to_string())
}

#[tauri::command]
pub fn git_diff(root: String, path: Option<String>) -> Result<String, String> {
    let mut args = vec!["diff", "--stat"];
    if path.is_some() {
        args = vec!["diff", "--"];
    }
    let mut cmd_args: Vec<&str> = args;
    let owned;
    if let Some(p) = path.as_ref() {
        // traversal guard: must stay within root
        let full = Path::new(&root).join(p);
        if !guard_within(&full, Path::new(&root)) {
            return Err("error: invalid path".to_string());
        }
        owned = p.clone();
        cmd_args.push(&owned);
    }
    let out = git_run(&root, &cmd_args)?;
    const CAP: usize = 200 * 1024;
    Ok(if out.len() > CAP { format!("{}…\n[truncated at 200KB]", &out[..CAP]) } else { out })
}

#[tauri::command]
pub fn git_commit(root: String, message: String) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("error: commit message required".to_string());
    }
    git_run(&root, &["add", "-A"])?;
    git_run(&root, &["commit", "-m", message.trim()])?;
    Ok("OK".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_skips_git_and_sorts_dirs_first() {
        let dir = std::env::temp_dir().join("omw-fs-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        std::fs::create_dir_all(dir.join("bdir")).unwrap();
        std::fs::write(dir.join("afile.txt"), "x").unwrap();
        let items = fs_list(dir.to_string_lossy().to_string()).unwrap();
        assert!(!items.iter().any(|i| i.name == ".git"));
        assert_eq!(items[0].name, "bdir");
        assert_eq!(items[1].name, "afile.txt");
    }

    #[test]
    fn porcelain_parse() {
        let m = parse_porcelain(" M edited.txt\nA  added.txt\n?? new.txt\nR  old.txt -> renamed.txt\n");
        assert_eq!(m["edited.txt"], "M");
        assert_eq!(m["added.txt"], "A");
        assert_eq!(m["new.txt"], "??");
        assert_eq!(m["renamed.txt"], "R");
    }

    #[test]
    fn git_outside_repo_errors_honestly() {
        let dir = std::env::temp_dir().join("omw-fs-norepo");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(git_status(dir.to_string_lossy().to_string()).is_err());
    }
}

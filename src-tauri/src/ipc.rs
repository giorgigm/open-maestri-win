//! Local InterAgent IPC server: HTTP POST /cli on 127.0.0.1 + dynamic port.
//!
//! Wire-identical to Sources/InterAgent/InterAgentServer.swift + Sources/CLI/Transport.swift:
//! request  `POST /cli HTTP/1.x` + `X-Terminal-ID: <uuid>` + `{"args":[...]}`,
//! response `HTTP/<same-version> 200 OK` + `text/plain; charset=utf-8` + plain-text body,
//! errors prefixed with `error: `. Localhost-only, single route.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;

pub const COMMANDS: &str = "list ask check note portal recruit dismiss connect role preset debug";

static PTY: std::sync::OnceLock<Arc<crate::pty::PtyManager>> = std::sync::OnceLock::new();

pub fn set_pty(pty: Arc<crate::pty::PtyManager>) {
    let _ = PTY.set(pty);
}

pub fn pty() -> Option<Arc<crate::pty::PtyManager>> {
    PTY.get().cloned()
}

/// Shared app state visible to CLI handlers (terminals registry + active workspace).
#[derive(Debug, Default)]
pub struct AgentRegistry {
    /// terminal_id -> display name
    pub terminals: Mutex<std::collections::HashMap<String, String>>,
    /// active workspace id (for note/portal resolution)
    pub workspace_id: Mutex<Option<String>>,
}

impl AgentRegistry {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn register_terminal(&self, id: &str, name: &str) {
        self.terminals
            .lock()
            .unwrap()
            .insert(id.to_string(), name.to_string());
    }
}

/// Route args -> plain-text response (mirrors CLIRouter.routeAsync).
pub fn route(args: &[String], terminal_id: Option<&str>, registry: &AgentRegistry, port: u16) -> String {
    let cmd = args.first().map(|s| s.as_str()).unwrap_or("");
    match cmd {
        "list" => handle_list(terminal_id, registry),
        "debug" => {
            let tid = terminal_id.unwrap_or("(none)");
            format!(
                "open-maestri inter-agent server debug:\n  Server port: {port}\n  Terminal ID: {tid}\n  Commands: {COMMANDS}"
            )
        }
        "ask" => {
            let Some(tid) = terminal_id else {
                return "error: missing terminal ID".to_string();
            };
            if args.len() < 3 {
                return "error: usage: omaestri ask \"Agent\" \"prompt\"".to_string();
            }
            match PTY.get() {
                Some(pty) => match crate::pty::match_terminal(registry, pty, tid, &args[1]) {
                    Some(target) => match pty.ask(&target, &args[2]) {
                        Ok(out) => out,
                        Err(e) => e,
                    },
                    None => format!("error: agent '{}' not found", args[1]),
                },
                None => format!("error: ask not connected (no live terminal '{}' in this build)", args[1]),
            }
        }
        "check" => {
            let Some(tid) = terminal_id else {
                return "error: missing terminal ID".to_string();
            };
            if args.len() < 2 {
                return "error: usage: omaestri check \"Agent\" [lines]".to_string();
            }
            let lines = args.get(2).and_then(|l| l.parse().ok()).unwrap_or(20);
            match PTY.get() {
                Some(pty) => match crate::pty::match_terminal(registry, pty, tid, &args[1]) {
                    Some(target) => pty
                        .recent_output(&target, lines)
                        .unwrap_or_else(|| format!("error: no output for '{}'", args[1])),
                    None => format!("error: agent '{}' not found", args[1]),
                },
                None => format!("error: check not connected (no live terminal '{}' in this build)", args[1]),
            }
        }
        "note" => handle_note(args, terminal_id, registry),
        "portal" => handle_portal(args, terminal_id, registry),
        "recruit" | "dismiss" | "connect" => handle_maestro(args, terminal_id, registry, port),
        "role" | "preset" => {
            if cmd == "preset" {
                return "Built-in presets:\n  - claude-code (claude)\n  - codex (codex)\n  - gemini (gemini)\n  - opencode (opencode)\n  - shell (powershell)".to_string();
            }
            "error: roles not implemented in this build".to_string()
        }
        "" => "error: empty command".to_string(),
        _ => format!("error: unknown command '{cmd}'. Try 'omaestri list' for available commands."),
    }
}

fn handle_maestro(args: &[String], terminal_id: Option<&str>, registry: &AgentRegistry, _port: u16) -> String {
    let cmd = args[0].as_str();
    match cmd {
        "recruit" => maestro_recruit(args, terminal_id, registry),
        "dismiss" => maestro_dismiss(args, terminal_id, registry),
        "connect" => maestro_connect(args, registry),
        _ => format!("error: unknown maestro command '{cmd}'"),
    }
}

fn maestro_caller_is_manager(registry: &AgentRegistry, ws: &str, tid: &str) -> Result<String, String> {
    let doc = crate::store::load_workspace_json(ws).map_err(|e| format!("error: {e}"))?;
    let nodes = doc.get("payload").and_then(|p| p.get("nodes")).and_then(|n| n.as_array());
    let Some(nodes) = nodes else { return Err("error: invalid workspace".to_string()) };
    for n in nodes {
        let content = n.get("content").and_then(|c| c.get("terminal")).and_then(|t| t.get("_0"));
        if let Some(t) = content {
            let cid = t.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let nid = n.get("id").and_then(|v| v.as_str()).unwrap_or("");
            if cid == tid || nid == tid {
                if t.get("isManager").and_then(|v| v.as_bool()) == Some(true) {
                    return Ok(t.get("workingDirectory").and_then(|v| v.as_str()).unwrap_or("").to_string());
                }
                return Err("error: this terminal is not in Maestro mode. Enable Maestro mode when creating the terminal.".to_string());
            }
        }
    }
    let map = registry.terminals.lock().unwrap();
    if !map.contains_key(tid) {
        return Err("error: recruit can only be called from a Maestro terminal".to_string());
    }
    Err("error: this terminal is not in Maestro mode. Enable Maestro mode when creating the terminal.".to_string())
}

fn parse_flags(args: &[String]) -> (String, String, String) {
    let mut preset = "generic_shell".to_string();
    let mut role = String::new();
    let mut command = String::new();
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--preset" if i + 1 < args.len() => {
                preset = args[i + 1].clone();
                i += 2;
            }
            "--role" if i + 1 < args.len() => {
                role = args[i + 1].clone();
                i += 2;
            }
            "--command" if i + 1 < args.len() => {
                command = args[i + 1].clone();
                i += 2;
            }
            _ => i += 1,
        }
    }
    (preset, role, command)
}

fn load_prefs_roles() -> Vec<(String, String)> {
    let path = crate::store::app_data_dir().join("preferences.json");
    let Ok(bytes) = std::fs::read(path) else { return vec![] };
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes) else { return vec![] };
    v.get("rolePresets")
        .and_then(|r| r.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|r| Some((r.get("name")?.as_str()?.to_string(), r.get("id")?.as_str()?.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

fn now_iso_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
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

fn maestro_recruit(args: &[String], terminal_id: Option<&str>, registry: &AgentRegistry) -> String {
    if args.len() < 2 {
        return "error: usage: omaestri recruit \"Name\" [--preset <agentType>] [--role <roleName>] [--command <cmd>]".to_string();
    }
    let Some(tid) = terminal_id else {
        return "error: missing terminal ID".to_string();
    };
    let ws = registry.workspace_id.lock().unwrap().clone();
    let Some(ws) = ws else {
        return "error: no active workspace".to_string();
    };
    let cwd = match maestro_caller_is_manager(registry, &ws, tid) {
        Ok(c) => c,
        Err(e) => return e,
    };
    let name = args[1].clone();
    let (preset_id, role_name, custom_cmd) = parse_flags(args);
    let presets = [
        ("claude_code", "Claude Code", "claude", "#007AFF"),
        ("codex", "Codex", "codex", "#5856D6"),
        ("gemini_cli", "Gemini CLI", "gemini", "#34C759"),
        ("open_code", "OpenCode", "opencode", "#FF9500"),
        ("generic_shell", "Shell", "", "#8E8E93"),
    ];
    let pl = preset_id.to_lowercase();
    let found = presets.iter().find(|(at, nm, cmd, _)| *at == pl || nm.to_lowercase() == pl || *cmd == pl);
    let (agent_type, cmd, color) = match found {
        Some((at, _, c, col)) => (at.to_string(), c.to_string(), col.to_string()),
        None => (
            "generic_shell".to_string(),
            if custom_cmd.is_empty() { preset_id.clone() } else { custom_cmd.clone() },
            "#8E8E93".to_string(),
        ),
    };
    let cmd = if !custom_cmd.is_empty() { custom_cmd } else { cmd };
    let role_id: Option<String> = if role_name.is_empty() {
        None
    } else {
        load_prefs_roles().iter().find(|(n, _)| n.to_lowercase() == role_name.to_lowercase()).map(|(_, id)| id.clone())
    };
    let mut doc = match crate::store::load_workspace_json(&ws) {
        Ok(d) => d,
        Err(e) => return format!("error: {e}"),
    };
    let recruit_id = uuid_simple();
    let conn_id = uuid_simple();
    let now = now_iso_simple();
    let node = serde_json::json!({
        "id": recruit_id,
        "frame": [[0.0, 0.0], [420.0, 300.0]],
        "content": {"terminal": {"_0": {
            "agentType": agent_type, "command": cmd, "name": name,
            "icon": "terminal", "color": color, "id": recruit_id,
            "shellPath": "powershell.exe", "workingDirectory": cwd,
            "status": "idle", "isManager": false, "monitorWithOmbro": false,
            "autoScrollLocked": false, "shortcutMode": {"kind": "automatic"},
            "assignedRoleId": role_id, "scrollbackLineCount": 0
        }}},
        "zIndex": 0, "isLocked": false, "createdAt": now, "lastModifiedAt": now
    });
    let conn = serde_json::json!({
        "id": conn_id, "createdAt": now,
        "terminalIdA": tid, "terminalIdB": recruit_id, "ropePoints": []
    });
    if let Some(p) = doc.get_mut("payload") {
        if let Some(nodes) = p.get_mut("nodes").and_then(|n| n.as_array_mut()) {
            nodes.push(node);
        }
        if let Some(conns) = p.get_mut("connections").and_then(|n| n.as_array_mut()) {
            conns.push(conn);
        }
        p["lastModifiedAt"] = serde_json::Value::String(now.clone());
    }
    match crate::store::save_workspace_json(&ws, &doc) {
        Ok(_) => {
            registry.register_terminal(&recruit_id, &name);
            let mut msg = format!("Recruited '{name}' with preset '{agent_type}'");
            if !role_name.is_empty() {
                msg.push_str(&format!(" and role '{role_name}'"));
            }
            msg
        }
        Err(e) => format!("error: {e}"),
    }
}

fn maestro_dismiss(args: &[String], terminal_id: Option<&str>, registry: &AgentRegistry) -> String {
    if args.len() < 2 {
        return "error: usage: omaestri dismiss \"Name\"".to_string();
    }
    let Some(tid) = terminal_id else {
        return "error: missing terminal ID".to_string();
    };
    let needle = args[1].to_lowercase();
    let target = {
        let map = registry.terminals.lock().unwrap();
        map.iter()
            .filter(|(id, _)| id.as_str() != tid)
            .find(|(id, name)| {
                name.to_lowercase().contains(&needle)
                    || id.to_lowercase().starts_with(&needle)
                    || id.to_lowercase() == needle
            })
            .map(|(id, _)| id.clone())
    };
    let Some(target) = target else {
        return format!("error: agent '{}' not found among connected agents", args[1]);
    };
    let ws = registry.workspace_id.lock().unwrap().clone();
    if let Some(ws) = ws {
        if let Ok(mut doc) = crate::store::load_workspace_json(&ws) {
            if let Some(p) = doc.get_mut("payload") {
                for key in ["connections", "noteConnections", "portalConnections"] {
                    if let Some(arr) = p.get_mut(key).and_then(|a| a.as_array_mut()) {
                        arr.retain(|c| {
                            let vals: Vec<String> = c
                                .as_object()
                                .map(|o| o.values().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                                .unwrap_or_default();
                            !vals.iter().any(|v| v == &target)
                        });
                    }
                }
                if let Some(nodes) = p.get_mut("nodes").and_then(|n| n.as_array_mut()) {
                    nodes.retain(|n| {
                        let nid = n.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        let cid = n
                            .get("content")
                            .and_then(|c| c.get("terminal"))
                            .and_then(|t| t.get("_0"))
                            .and_then(|t| t.get("id"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        nid != target && cid != target
                    });
                }
            }
            let _ = crate::store::save_workspace_json(&ws, &doc);
        }
    }
    if let Some(pty) = PTY.get() {
        pty.kill(&target);
    }
    registry.terminals.lock().unwrap().remove(&target);
    format!("Dismissed '{}'", args[1])
}

fn maestro_connect(args: &[String], registry: &AgentRegistry) -> String {
    if args.len() < 3 {
        return "error: usage: omaestri connect \"From\" \"To\"".to_string();
    }
    let ws = registry.workspace_id.lock().unwrap().clone();
    let Some(ws) = ws else {
        return "error: no active workspace".to_string();
    };
    let (from, to) = (args[1].clone(), args[2].clone());
    let (f, t) = {
        let map = registry.terminals.lock().unwrap();
        let find = |needle: &str| {
            map.iter()
                .find(|(_, name)| name.to_lowercase().contains(&needle.to_lowercase()))
                .map(|(id, _)| id.clone())
        };
        (find(&from), find(&to))
    };
    let (Some(f), Some(t)) = (f, t) else {
        return "error: agent not found (both must be known terminals)".to_string();
    };
    let mut doc = match crate::store::load_workspace_json(&ws) {
        Ok(d) => d,
        Err(e) => return format!("error: {e}"),
    };
    let now = now_iso_simple();
    let conn = serde_json::json!({
        "id": uuid_simple(), "createdAt": now,
        "terminalIdA": f, "terminalIdB": t, "ropePoints": []
    });
    if let Some(p) = doc.get_mut("payload") {
        if let Some(arr) = p.get_mut("connections").and_then(|a| a.as_array_mut()) {
            arr.push(conn);
        }
    }
    match crate::store::save_workspace_json(&ws, &doc) {
        Ok(_) => format!("Connected '{from}' ↔ '{to}'"),
        Err(e) => format!("error: {e}"),
    }
}

fn handle_list(terminal_id: Option<&str>, registry: &AgentRegistry) -> String {
    let tid = match terminal_id {
        Some(t) => t,
        None => return "error: missing terminal ID".to_string(),
    };
    let map = registry.terminals.lock().unwrap();
    let mut sections = Vec::new();
    if let Some(name) = map.get(tid) {
        sections.push(format!("You:\n  - name: \"{name}\""));
    }
    let others: Vec<String> = map
        .iter()
        .filter(|(id, _)| id.as_str() != tid)
        .map(|(_, name)| format!("  - name: \"{name}\""))
        .collect();
    if others.is_empty() {
        let base = if sections.is_empty() {
            String::new()
        } else {
            sections.join("\n\n") + "\n\n"
        };
        return format!("{base}No connections.");
    }
    sections.push(format!("Connected agents:\n{}", others.join("\n")));
    sections.join("\n\n")
}

fn handle_note(args: &[String], terminal_id: Option<&str>, registry: &AgentRegistry) -> String {
    if terminal_id.is_none() {
        return "error: missing terminal ID".to_string();
    }
    if args.len() < 2 {
        return "error: usage: omaestri note <read|write|edit|create> ...".to_string();
    }
    let ws = registry.workspace_id.lock().unwrap().clone();
    let Some(ws) = ws else {
        return "error: no active workspace".to_string();
    };
    match args[1].as_str() {
        "create" => {
            let content = args.get(2).cloned().unwrap_or_default();
            let fname = format!("Note-{}.md", &uuid_simple()[..8.min(uuid_simple().len())]);
            let path = crate::store::notes_dir(&ws).join(&fname);
            if let Err(e) = std::fs::create_dir_all(path.parent().unwrap())
                .and_then(|_| std::fs::write(&path, content))
            {
                return format!("error: note create failed: {e}");
            }
            format!("Created note \"{}\"", fname.trim_end_matches(".md"))
        }
        "read" => {
            if args.len() < 3 {
                return "error: usage: omaestri note read \"Name\"".to_string();
            }
            // offset/limit like the Mac CLI documents (gap fixed vs Swift handler)
            let offset = args.get(3).and_then(|o| o.parse::<usize>().ok());
            let limit = args.get(4).and_then(|l| l.parse::<usize>().ok());
            match resolve_note_path(&ws, &args[2]) {
                Some(p) => match std::fs::read_to_string(&p) {
                    Ok(content) => with_line_range(&content, offset, limit),
                    Err(e) => format!("error: note read failed: {e}"),
                },
                None => format!("error: note '{}' not found", args[2]),
            }
        }
        "write" => {
            if args.len() < 4 {
                return "error: usage: omaestri note write \"Name\" \"content\"".to_string();
            }
            match resolve_note_path(&ws, &args[2]) {
                Some(p) => match std::fs::write(p, &args[3]) {
                    Ok(_) => "OK".to_string(),
                    Err(e) => format!("error: note write failed: {e}"),
                },
                None => {
                    // create-if-missing inside active workspace
                    let fname = format!("{}.md", args[2]);
                    let path = crate::store::notes_dir(&ws).join(&fname);
                    match std::fs::create_dir_all(path.parent().unwrap())
                        .and_then(|_| std::fs::write(&path, &args[3]))
                    {
                        Ok(_) => "OK".to_string(),
                        Err(e) => format!("error: note write failed: {e}"),
                    }
                }
            }
        }
        "edit" => {
            if args.len() < 5 {
                return "error: usage: omaestri note edit \"Name\" \"old\" \"new\"".to_string();
            }
            match resolve_note_path(&ws, &args[2]) {
                Some(p) => match std::fs::read_to_string(&p) {
                    Ok(content) => match content.find(args[3].as_str()) {
                        Some(idx) => {
                            let mut out = content;
                            out.replace_range(idx..idx + args[3].len(), &args[4]);
                            match std::fs::write(p, out) {
                                Ok(_) => "OK".to_string(),
                                Err(e) => format!("error: note edit failed: {e}"),
                            }
                        }
                        None => "error: old text not found".to_string(),
                    },
                    Err(e) => format!("error: note read failed: {e}"),
                },
                None => format!("error: note '{}' not found", args[2]),
            }
        }
        sub => format!("error: unknown note subcommand '{sub}'"),
    }
}

fn with_line_range(content: &str, offset: Option<usize>, limit: Option<usize>) -> String {    // mirrors NoteFileManager.readWithLineRange: `[N lines total]\n1    ...`
    let lines: Vec<&str> = content.split('\n').collect();
    let total = lines.len();
    let start = offset.map(|o| o.saturating_sub(1)).unwrap_or(0).min(total);
    let end = limit.map(|l| start + l).unwrap_or(total).min(total);
    let header = match (offset, limit) {
        (Some(o), Some(l)) => format!("[lines {}-{} of {}]", o, o + l - 1, total),
        _ => format!("[{} lines total]", total),
    };
    let numbered: Vec<String> =
        lines[start..end].iter().enumerate().map(|(i, l)| format!("{}    {}", start + i + 1, l)).collect();
    format!("{}\n{}", header, numbered.join("\n"))
}

fn handle_portal(args: &[String], terminal_id: Option<&str>, registry: &AgentRegistry) -> String {
    if terminal_id.is_none() {
        return "error: missing terminal ID".to_string();
    }
    if args.len() < 2 {
        return "error: usage: omaestri portal <navigate|info|snapshot> ...".to_string();
    }
    let ws = registry.workspace_id.lock().unwrap().clone();
    let Some(ws) = ws else {
        return "error: no active workspace".to_string();
    };
    let sub = args[1].as_str();
    // resolve portal BY NAME from the active workspace (fixes Mac resolvePortalId ignoring name)
    let find_portal = |name: &str| -> Option<(String, serde_json::Value)> {
        let doc = crate::store::load_workspace_json(&ws).ok()?;
        let nodes = doc.get("payload")?.get("nodes")?.as_array()?;
        let needle = name.to_lowercase();
        let mut fuzzy = None;
        for n in nodes {
            let content = n.get("content")?.get("portal")?.get("_0")?;
            let pname = content.get("name")?.as_str()?;
            let id = n.get("id")?.as_str()?;
            if pname == name {
                return Some((id.to_string(), content.clone()));
            }
            if fuzzy.is_none() && pname.to_lowercase().contains(&needle) {
                fuzzy = Some((id.to_string(), content.clone()));
            }
        }
        fuzzy
    };
    match sub {
        "navigate" => {
            if args.len() < 4 {
                return "error: usage: omaestri portal navigate \"Name\" \"URL\"".to_string();
            }
            let Some((pid, _)) = find_portal(&args[2]) else {
                return format!("error: portal '{}' not found", args[2]);
            };
            match set_portal_url(&ws, &pid, &args[3]) {
                Ok(_) => "OK".to_string(),
                Err(e) => e,
            }
        }
        "info" => {
            if args.len() < 3 {
                return "error: usage: omaestri portal info \"Name\"".to_string();
            }
            match find_portal(&args[2]) {
                Some((_, c)) => format!(
                    "name: \"{}\"\nurl: {}\nstatus: {}",
                    c.get("name").and_then(|v| v.as_str()).unwrap_or("?"),
                    c.get("currentURL").and_then(|v| v.as_str()).unwrap_or(""),
                    c.get("status").and_then(|v| v.as_str()).unwrap_or("idle")
                ),
                None => format!("error: portal '{}' not found", args[2]),
            }
        }
        "snapshot" => {
            // estágio 1: iframe embed — accessibility tree indisponível cross-origin
            "error: portal snapshot needs the native WebView2 stage (portal shows pages; automation lands in stage 2)".to_string()
        }
        _ => format!("error: unknown portal subcommand '{sub}' (stage 1: navigate|info|snapshot)"),
    }
}

fn set_portal_url(workspace_id: &str, node_id: &str, url: &str) -> Result<(), String> {
    let mut doc = crate::store::load_workspace_json(workspace_id)?;
    let nodes = doc
        .get_mut("payload")
        .and_then(|p| p.get_mut("nodes"))
        .and_then(|n| n.as_array_mut())
        .ok_or_else(|| "error: invalid workspace".to_string())?;
    for n in nodes.iter_mut() {
        if n.get("id").and_then(|v| v.as_str()) == Some(node_id) {
            let content = n
                .get_mut("content")
                .and_then(|c| c.get_mut("portal"))
                .and_then(|p| p.get_mut("_0"))
                .ok_or_else(|| "error: not a portal".to_string())?;
            content["currentURL"] = serde_json::Value::String(url.to_string());
            content["source"] = serde_json::json!({"url": {"_0": url}});
            crate::store::save_workspace_json(workspace_id, &doc)?;
            return Ok(());
        }
    }
    Err(format!("error: portal node '{node_id}' not found"))
}

fn resolve_note_path(workspace_id: &str, name: &str) -> Option<std::path::PathBuf> {
    let dir = crate::store::notes_dir(workspace_id);
    let exact = dir.join(format!("{name}.md"));
    if exact.exists() {
        return Some(exact);
    }
    if name.ends_with(".md") {
        let p = dir.join(name);
        if p.exists() {
            return Some(p);
        }
    }
    // fuzzy: case-insensitive substring
    let needle = name.to_lowercase();
    std::fs::read_dir(&dir).ok()?.flatten().find_map(|e| {
        let fname = e.file_name().to_string_lossy().to_lowercase();
        if fname.ends_with(".md") && fname.contains(&needle) {
            Some(e.path())
        } else {
            None
        }
    })
}

fn uuid_simple() -> String {
    // cheap unique suffix without extra deps
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}

// ---------------------------------------------------------------- HTTP layer

struct ParsedRequest {
    args: Vec<String>,
    terminal_id: Option<String>,
    http_version: String,
}

fn parse_http_request(data: &[u8]) -> Result<ParsedRequest, String> {
    let raw = String::from_utf8_lossy(data);
    let parts: Vec<&str> = raw.split("\r\n\r\n").collect();
    let headers = parts.first().unwrap_or(&"");
    let body = parts.get(1).unwrap_or(&"");
    let mut lines = headers.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let http_version = if request_line.contains("HTTP/1.0") {
        "1.0".to_string()
    } else {
        "1.1".to_string()
    };
    if !request_line.starts_with("POST /cli ") {
        return Err("only POST /cli is supported".to_string());
    }
    let mut terminal_id = None;
    for line in lines {
        if line.to_lowercase().starts_with("x-terminal-id:") {
            terminal_id = Some(line["x-terminal-id:".len()..].trim().to_string());
        }
    }
    let json: serde_json::Value =
        serde_json::from_str(body).map_err(|_| "error: missing args".to_string())?;
    let args: Vec<String> = json
        .get("args")
        .and_then(|a| a.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    if args.is_empty() {
        return Err("error: missing args".to_string());
    }
    Ok(ParsedRequest { args, terminal_id, http_version })
}

fn build_http_response(body: &str, version: &str) -> Vec<u8> {
    let header = format!(
        "HTTP/{version} 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    [header.as_bytes(), body.as_bytes()].concat()
}

fn content_length(headers: &str) -> usize {
    for line in headers.split("\r\n") {
        if line.to_lowercase().starts_with("content-length:") {
            return line["content-length:".len()..].trim().parse().unwrap_or(0);
        }
    }
    0
}

fn handle_client(mut stream: TcpStream, registry: Arc<AgentRegistry>, port: u16) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    // read until header + declared body received
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                let text = String::from_utf8_lossy(&buf);
                if let Some(end) = text.find("\r\n\r\n") {
                    let len = content_length(&text[..end]);
                    if buf.len() >= end + 4 + len {
                        break;
                    }
                }
                if buf.len() > 1024 * 1024 {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let response = match parse_http_request(&buf) {
        Ok(req) => {
            let body = route(&req.args, req.terminal_id.as_deref(), &registry, port);
            build_http_response(&body, &req.http_version)
        }
        Err(e) => build_http_response(&e, "1.1"),
    };
    let _ = stream.write_all(&response);
}

pub struct IpcServer {
    pub port: u16,
    shutdown_tx: Option<mpsc::Sender<()>>,
    handle: Option<thread::JoinHandle<()>>,
}

impl IpcServer {
    /// Bind 127.0.0.1:0 (dynamic port), spawn accept loop. Returns bound port.
    pub fn start(registry: Arc<AgentRegistry>) -> std::io::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        listener.set_nonblocking(true)?;
        let (tx, rx) = mpsc::channel::<()>();
        let handle = thread::spawn(move || {
            loop {
                if rx.try_recv().is_ok() {
                    break;
                }
                match listener.accept() {
                    Ok((stream, _)) => {
                        let reg = registry.clone();
                        thread::spawn(move || handle_client(stream, reg, port));
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(std::time::Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });
        // persist port for CLI discovery (replaces agent.sock on Windows)
        if let Err(e) = (|| -> std::io::Result<()> {
            let run = crate::store::app_data_dir().join("run");
            std::fs::create_dir_all(&run)?;
            std::fs::write(run.join("agent.port"), port.to_string())?;
            Ok(())
        })() {
            eprintln!("ipc: could not persist port: {e}");
        }
        Ok(Self { port, shutdown_tx: Some(tx), handle: Some(handle) })
    }

    pub fn addr(&self) -> SocketAddr {
        SocketAddr::from(([127, 0, 0, 1], self.port))
    }
}

impl Drop for IpcServer {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn post(port: u16, args: &[&str], tid: Option<&str>, version: &str) -> (String, String) {
        let body = serde_json::json!({"args": args}).to_string();
        let mut req = format!("POST /cli HTTP/{version}\r\nHost: maestri\r\n");
        if let Some(t) = tid {
            req.push_str(&format!("X-Terminal-ID: {t}\r\n"));
        }
        req.push_str(&format!(
            "Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        ));
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(req.as_bytes()).unwrap();
        let mut resp = Vec::new();
        s.read_to_end(&mut resp).unwrap();
        let text = String::from_utf8_lossy(&resp).to_string();
        let (head, body) = text.split_once("\r\n\r\n").unwrap();
        (head.to_string(), body.to_string())
    }

    #[test]
    fn cli_wire_protocol() {
        let _lock = ENV_LOCK.lock().unwrap();
        let _d = std::env::temp_dir().join("omw-ipc-test-wire");
        unsafe { std::env::set_var("OPEN_MAESTRI_DATA_DIR", &_d) };
        let reg = AgentRegistry::new();
        reg.register_terminal("tid-1", "Shell");
        let server = IpcServer::start(reg.clone()).unwrap();

        // list echoes HTTP/1.0 version like the Swift CLI sends
        let (head, body) = post(server.port, &["list"], Some("tid-1"), "1.0");
        assert!(head.starts_with("HTTP/1.0 200 OK"), "{head}");
        assert!(body.contains("You:"), "{body}");

        // unknown command + missing tid paths
        let (_, b2) = post(server.port, &["bogus"], Some("tid-1"), "1.1");
        assert!(b2.starts_with("error: unknown command"), "{b2}");
        let (_, b3) = post(server.port, &["list"], None, "1.1");
        assert_eq!(b3, "error: missing terminal ID");

        // note create/read round-trip
        {
            let ws = "ws-notes";
            crate::store::ensure_workspace_dirs(ws).unwrap();
            *reg.workspace_id.lock().unwrap() = Some(ws.to_string());
            let (_, c) = post(server.port, &["note", "create", "hello"], Some("tid-1"), "1.1");
            assert!(c.starts_with("Created note"), "{c}");
            let name = c.trim_start_matches("Created note \"").trim_end_matches('"');
            let (_, r) = post(server.port, &["note", "read", name], Some("tid-1"), "1.1");
            assert_eq!(r, "[1 lines total]\n1    hello");
            let (_, w) = post(server.port, &["note", "write", name, "world"], Some("tid-1"), "1.1");
            assert_eq!(w, "OK");
            let (_, e) = post(server.port, &["note", "edit", name, "world", "WORLD"], Some("tid-1"), "1.1");
            assert_eq!(e, "OK");
        }

        // debug mirrors Swift buildDebugInfo
        let (_, d) = post(server.port, &["debug"], Some("tid-1"), "1.1");
        assert!(d.contains(&format!("Server port: {}", server.port)));
        assert!(d.contains(COMMANDS));
    }

    #[test]
    fn note_needs_workspace() {
        let reg = AgentRegistry::new();
        let out = route(
            &["note".into(), "read".into(), "X".into()],
            Some("t"),
            &reg,
            1,
        );
        assert_eq!(out, "error: no active workspace");
    }
}

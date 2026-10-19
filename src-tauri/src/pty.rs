//! Real PTY backend on Windows via ConPTY (`portable-pty`).
//!
//! Mirrors SwiftTermProvider (env/launch), TerminalManager (ring 500/write),
//! TerminalActivityMonitor (idle 2s), ScrollbackStore (JSONL, 5000 lines).
//! Frontend receives `pty-output:{id}` / `pty-exit:{id}` / `pty-idle:{id}` events.

use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex};
use tauri::Emitter;

pub const RING_MAX: usize = 500;
pub const SCROLLBACK_KEEP: usize = 5000;
pub const IDLE_SECS: u64 = 2;
pub const ASK_TIMEOUT_SECS: u64 = 30;

struct Session {
    writer: Box<dyn std::io::Write + Send>,
    _master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    ring: Vec<String>,
    last_output: std::time::Instant,
    has_task: bool,
    dirty: bool,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, Session>>,
    app: tauri::AppHandle,
    ipc_port: u16,
}

impl PtyManager {
    pub fn new(app: tauri::AppHandle, ipc_port: u16) -> Arc<Self> {
        Arc::new(Self { sessions: Mutex::new(HashMap::new()), app, ipc_port })
    }

    fn scrollback_path(&self, id: &str, workspace_id: Option<&str>) -> std::path::PathBuf {
        let ws = workspace_id.unwrap_or("default");
        crate::store::terminals_dir(ws).join(format!("{id}.scrollback"))
    }

    pub fn spawn(
        self: &Arc<Self>,
        terminal_id: String,
        command: String,
        cwd: String,
        cols: u16,
        rows: u16,
        workspace_id: Option<String>,
        agent_name: Option<String>,
    ) -> Result<(), String> {
        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("error: pty open: {e}"))?;

        // persistent shell like the Mac (zsh --login); agent command runs inside it
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.args(["-NoLogo", "-NoExit"]);
        if !cwd.is_empty() {
            cmd.cwd(&cwd);
        }
        // env mirrors SwiftTermProvider.swift:116-135
        cmd.env("MAESTRI_TERMINAL_ID", &terminal_id);
        cmd.env("OMAESTRI_TERMINAL_ID", &terminal_id);
        cmd.env("MAESTRI_SOCKET", format!("127.0.0.1:{}", self.ipc_port));
        cmd.env("TERM", "xterm-256color");
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                let omaestri = dir.join("omaestri.exe");
                if omaestri.exists() {
                    cmd.env("MAESTRI_CLI", omaestri.to_string_lossy().to_string());
                }
            }
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("error: spawn: {e}"))?;
        // restore previous scrollback (plain text replay happens frontend-side)
        let ring = load_scrollback_lines(&self.scrollback_path(&terminal_id, workspace_id.as_deref()));

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("error: writer: {e}"))?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("error: reader: {e}"))?;

        self.sessions.lock().unwrap().insert(
            terminal_id.clone(),
            Session {
                writer,
                _master: pair.master,
                child,
                ring,
                last_output: std::time::Instant::now(),
                has_task: false,
                dirty: false,
            },
        );

        // startup command (agent CLI) sent after spawn, like pendingStartupCommands
        if !command.is_empty() {
            let _ = self.write(&terminal_id, &format!("{command}\r"));
        }
        if let Some(name) = agent_name {
            let _ = self.write(&terminal_id, &format!("$env:OMAESTRI_AGENT_NAME=\"{name}\"\r"));
        }

        // read loop
        let this = self.clone();
        let tid = terminal_id.clone();
        let ws = workspace_id.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        this.on_output(&tid, &text);
                    }
                    Err(_) => break,
                }
            }
            // exit
            let code = this
                .sessions
                .lock()
                .unwrap()
                .get_mut(&tid)
                .and_then(|s| s.child.try_wait().ok().flatten())
                .map(|st| if st.success() { 0 } else { -1 })
                .unwrap_or(-1);
            this.flush(&tid, ws.as_deref());
            let _ = this.app.emit(&format!("pty-exit:{tid}"), code);
        });

        // idle watcher (2s, only with active task — mirrors markIdle gate)
        let this2 = self.clone();
        let tid2 = terminal_id.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let idle = {
                let map = this2.sessions.lock().unwrap();
                match map.get(&tid2) {
                    Some(s) => s.has_task && s.last_output.elapsed().as_secs() >= IDLE_SECS,
                    None => break,
                }
            };
            if idle {
                {
                    let mut map = this2.sessions.lock().unwrap();
                    if let Some(s) = map.get_mut(&tid2) {
                        s.has_task = false;
                    }
                }
                let _ = this2.app.emit(&format!("pty-idle:{tid2}"), ());
            }
        });

        // periodic scrollback flush every 8s (mirrors Swift flushScrollback debounce)
        let this3 = self.clone();
        let tid3 = terminal_id.clone();
        let ws3 = workspace_id.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(8));
            let alive = this3.sessions.lock().unwrap().contains_key(&tid3);
            if !alive {
                break;
            }
            this3.flush(&tid3, ws3.as_deref());
        });

        Ok(())
    }

    fn on_output(&self, id: &str, text: &str) {
        {
            let mut map = self.sessions.lock().unwrap();
            if let Some(s) = map.get_mut(id) {
                for line in text.split('\n') {
                    s.ring.push(strip_ansi(line));
                    if s.ring.len() > RING_MAX {
                        s.ring.drain(0..s.ring.len() - RING_MAX);
                    }
                }
                s.last_output = std::time::Instant::now();
                s.dirty = true;
            }
        }
        let _ = self.app.emit(&format!("pty-output:{id}"), text.to_string());
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        use std::io::Write;
        let mut map = self.sessions.lock().unwrap();
        let s = map.get_mut(id).ok_or_else(|| format!("error: unknown terminal '{id}'"))?;
        s.writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("error: write: {e}"))?;
        s.writer.flush().map_err(|e| format!("error: flush: {e}"))?;
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let map = self.sessions.lock().unwrap();
        let s = map.get(id).ok_or_else(|| format!("error: unknown terminal '{id}'"))?;
        s._master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("error: resize: {e}"))
    }

    pub fn kill(&self, id: &str) {
        let mut map = self.sessions.lock().unwrap();
        if let Some(mut s) = map.remove(id) {
            let _ = s.child.kill();
        }
    }

    pub fn recent_output(&self, id: &str, lines: usize) -> Option<String> {
        let map = self.sessions.lock().unwrap();
        map.get(id).map(|s| {
            let n = lines.min(s.ring.len());
            s.ring[s.ring.len() - n..].join("\n")
        })
    }

    pub fn mark_task(&self, id: &str) {
        if let Some(s) = self.sessions.lock().unwrap().get_mut(id) {
            s.has_task = true;
            s.last_output = std::time::Instant::now();
        }
    }

    /// Inject prompt+\r and wait for idle or 30s timeout (mirrors AskHandler).
    pub fn ask(&self, id: &str, prompt: &str) -> Result<String, String> {
        self.mark_task(id);
        self.write(id, &format!("{prompt}\r"))?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(ASK_TIMEOUT_SECS);
        loop {
            std::thread::sleep(std::time::Duration::from_millis(200));
            let done = {
                let map = self.sessions.lock().unwrap();
                match map.get(id) {
                    Some(s) => !s.has_task || std::time::Instant::now() >= deadline,
                    None => true,
                }
            };
            if done {
                break;
            }
        }
        Ok(self.recent_output(id, 60).unwrap_or_default())
    }

    fn flush(&self, id: &str, workspace_id: Option<&str>) {
        let lines: Vec<String> = {
            let mut map = self.sessions.lock().unwrap();
            match map.get_mut(id) {
                Some(s) if s.dirty => {
                    s.dirty = false;
                    let n = s.ring.len().min(SCROLLBACK_KEEP);
                    s.ring[s.ring.len() - n..].to_vec()
                }
                _ => return,
            }
        };
        let path = self.scrollback_path(id, workspace_id);
        let content = lines.join("\n");
        let _ = crate::store::atomic_write(&path, content.as_bytes());
    }
}

fn load_scrollback_lines(path: &std::path::Path) -> Vec<String> {
    let Ok(content) = std::fs::read_to_string(path) else { return vec![] };
    // JSONL (Swift) or plain text (ours) — take plain lines, keep last 5000
    let lines: Vec<String> = if content.trim_start().starts_with('[') {
        serde_json::from_str::<Vec<String>>(&content).unwrap_or_default()
    } else {
        content.lines().map(|l| l.to_string()).collect()
    };
    let n = lines.len().min(SCROLLBACK_KEEP);
    lines[lines.len() - n..].to_vec()
}

fn strip_ansi(s: &str) -> String {
    // minimal CSI strip for the check ring (mirrors CheckHandler ANSI strip)
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' && chars.peek() == Some(&'[') {
            chars.next();
            for c2 in chars.by_ref() {
                if c2.is_ascii_alphabetic() {
                    break;
                }
            }
        } else if c == '\r' {
            continue;
        } else {
            out.push(c);
        }
    }
    out
}

/// Match a terminal by name/command substring or id-prefix8 (mirrors AskHandler matching).
pub fn match_terminal(
    registry: &crate::ipc::AgentRegistry,
    pty: &Arc<PtyManager>,
    caller: &str,
    target: &str,
) -> Option<String> {
    let map = registry.terminals.lock().unwrap();
    let needle = target.to_lowercase();
    let mut candidates: Vec<String> = vec![];
    // pty sessions known via registry names; fall back to direct id match
    for (id, name) in map.iter() {
        if id.as_str() == caller {
            continue;
        }
        if name.to_lowercase().contains(&needle)
            || id.to_lowercase().starts_with(&needle)
            || id.to_lowercase() == needle
        {
            candidates.push(id.clone());
        }
    }
    // also allow direct session id even if unnamed
    if candidates.is_empty() {
        let sessions = pty.sessions.lock().unwrap();
        for id in sessions.keys() {
            if id.as_str() == caller {
                continue;
            }
            if id.to_lowercase().starts_with(&needle) || id.to_lowercase() == needle {
                candidates.push(id.clone());
            }
        }
    }
    candidates.into_iter().next()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ansi_strip_and_ring_discipline() {
        assert_eq!(strip_ansi("\x1b[32mgreen\x1b[0m plain"), "green plain");
        assert_eq!(strip_ansi("a\rb"), "ab");
        // ring eviction is structural (RING_MAX=500); check constant parity with Swift bufferMaxLines
        assert_eq!(RING_MAX, 500);
        assert_eq!(SCROLLBACK_KEEP, 5000);
        assert_eq!(IDLE_SECS, 2);
        assert_eq!(ASK_TIMEOUT_SECS, 30);
    }

    #[test]
    fn scrollback_load_tolerates_both_formats() {
        let dir = std::env::temp_dir().join("omw-pty-test");
        let _ = std::fs::create_dir_all(&dir);
        let p1 = dir.join("a.scrollback");
        std::fs::write(&p1, "l1\nl2\nl3").unwrap();
        assert_eq!(load_scrollback_lines(&p1), vec!["l1", "l2", "l3"]);
        let p2 = dir.join("b.scrollback");
        std::fs::write(&p2, "[\"x\",\"y\"]").unwrap();
        assert_eq!(load_scrollback_lines(&p2), vec!["x", "y"]);
        assert!(load_scrollback_lines(&dir.join("missing")).is_empty());
    }
}

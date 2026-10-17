//! omaestri — inter-agent CLI for open-maestri-win.
//!
//! CLI-identical to Sources/CLI/*.swift. Transport: TCP 127.0.0.1:<port>.
//! Endpoint discovery (in order):
//!   1. MAESTRI_SOCKET = "127.0.0.1:PORT" (set by the app; Windows form)
//!   2. MAESTRI_PORT env var
//!   3. <data-dir>/run/agent.port (written by IpcServer::start)
//! Gate: MAESTRI_TERMINAL_ID must be set (same message/exit as Swift main.swift).

use std::io::{Read, Write};
use std::net::TcpStream;

fn print_help() {
    print!(
        "\
omaestri — open-maestri inter-agent CLI

Usage: omaestri <command> [args...]

Commands:
  list                              List connected agents, notes, portals
  ask \"Agent\" \"prompt\"              Send prompt to connected agent
  check \"Agent\" [lines]             View agent's recent output
  note <read|write|edit|create>     Read/write connected notes
  portal <subcommand>               Interact with connected portals
  recruit \"Name\" [--preset x]       Recruit a new agent (Maestro only)
  dismiss \"Name\"                    Dismiss a recruited agent
  connect \"From\" \"To\"               Connect two agents
  role <list|create|show|edit|write|assign>  Manage agent roles
  preset list                       List available agent presets
  debug                             Diagnose connection issues

Environment:
  MAESTRI_SOCKET       \"127.0.0.1:PORT\" (set by open-maestri)
  MAESTRI_PORT         Port override
  MAESTRI_TERMINAL_ID  Terminal UUID (set by open-maestri)
  MAESTRI_CLI          Path to this binary
"
    );
}

fn data_dir() -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("OPEN_MAESTRI_DATA_DIR") {
        return dir.into();
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        return std::path::PathBuf::from(appdata).join("open-maestri");
    }
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home).join(".open-maestri")
}

fn discover_endpoint() -> Result<String, String> {
    if let Ok(sock) = std::env::var("MAESTRI_SOCKET") {
        let s = sock.trim().to_string();
        if s.contains(':') {
            return Ok(s);
        }
        // legacy/odd value? try as port
        if s.parse::<u16>().is_ok() {
            return Ok(format!("127.0.0.1:{s}"));
        }
    }
    if let Ok(port) = std::env::var("MAESTRI_PORT") {
        return Ok(format!("127.0.0.1:{}", port.trim()));
    }
    let port_file = data_dir().join("run").join("agent.port");
    match std::fs::read_to_string(&port_file) {
        Ok(p) => Ok(format!("127.0.0.1:{}", p.trim())),
        Err(_) => Err(format!(
            "error: cannot find server (set MAESTRI_SOCKET, or is open-maestri running? looked at {})",
            port_file.display()
        )),
    }
}

fn send(args: &[String], endpoint: &str, terminal_id: &str) -> Result<String, String> {
    let body = format!(
        "{{\"args\":[{}]}}",
        args.iter()
            .map(|a| {
                let mut e = String::with_capacity(a.len() + 2);
                e.push('"');
                for c in a.chars() {
                    match c {
                        '"' => e.push_str("\\\""),
                        '\\' => e.push_str("\\\\"),
                        '\n' => e.push_str("\\n"),
                        '\r' => e.push_str("\\r"),
                        '\t' => e.push_str("\\t"),
                        c => e.push(c),
                    }
                }
                e.push('"');
                e
            })
            .collect::<Vec<_>>()
            .join(",")
    );
    let request = format!(
        "POST /cli HTTP/1.0\r\nHost: maestri\r\nX-Terminal-ID: {terminal_id}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    let mut stream =
        TcpStream::connect(endpoint).map_err(|e| format!("error: connection failed: {e}"))?;
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("error: send failed: {e}"))?;
    let mut resp = Vec::new();
    stream
        .read_to_end(&mut resp)
        .map_err(|e| format!("error: recv failed: {e}"))?;
    let text = String::from_utf8_lossy(&resp).to_string();
    let Some(status_line) = text.lines().next() else {
        return Err("error: invalid HTTP response".to_string());
    };
    let code: u16 = status_line.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
    if code >= 300 || code == 0 {
        return Err(format!("Request failed (status {code})"));
    }
    match text.split_once("\r\n\r\n") {
        Some((_, b)) => Ok(b.to_string()),
        None => Ok(text),
    }
}

fn run_debug(endpoint: &str, terminal_id: &str) {
    println!("=== open-maestri CLI Diagnostics ===\n");
    println!("Terminal ID:      {terminal_id}");
    println!("Endpoint:         {endpoint}\n");
    println!("Testing connection...");
    match send(&["debug".to_string()], endpoint, terminal_id) {
        Ok(r) if !r.starts_with("error") => println!("Connection:       OK\n"),
        Ok(r) => println!("Connection:       FAILED\nError: {r}"),
        Err(e) => println!("Connection:       FAILED\nError: {e}"),
    }
    let binary = std::env::var("MAESTRI_CLI").unwrap_or_else(|_| std::env::args().next().unwrap());
    println!("Binary:           {binary}");
    println!(
        "PATH:             {}",
        std::env::var("PATH").unwrap_or("(not set)".to_string())
    );
    println!(
        "\n=== Troubleshooting ===\n\nIf \"connection failed\":\n  → The open-maestri app may not be running, or this terminal was launched outside open-maestri.\n\nIf \"omaestri: command not found\":\n  → Your shell resets PATH. Use \"$MAESTRI_CLI\" instead of \"omaestri\".\n"
    );
}

fn main() {
    let terminal_id = std::env::var("MAESTRI_TERMINAL_ID").unwrap_or_default();
    if terminal_id.is_empty() {
        eprintln!("only available inside open-maestri terminals (MAESTRI_TERMINAL_ID not set).");
        std::process::exit(1);
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(command) = args.first().cloned() else {
        print_help();
        std::process::exit(1);
    };
    if ["-h", "--help", "help"].contains(&command.as_str()) {
        print_help();
        return;
    }
    let endpoint = match discover_endpoint() {
        Ok(e) => e,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    if command == "debug" && std::env::var("MAESTRI_DEBUG_LOCAL").is_ok() {
        run_debug(&endpoint, &terminal_id);
        return;
    }
    // `debug` goes through the server AND prints local diagnostics header
    if command == "debug" {
        match send(&args, &endpoint, &terminal_id) {
            Ok(r) => {
                println!("=== open-maestri CLI Diagnostics ===\n");
                println!("Terminal ID:      {terminal_id}");
                println!("Endpoint:         {endpoint}\n");
                println!("Connection:       OK\n");
                println!("{r}");
            }
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        return;
    }
    match send(&args, &endpoint, &terminal_id) {
        Ok(r) => print!("{r}"),
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}

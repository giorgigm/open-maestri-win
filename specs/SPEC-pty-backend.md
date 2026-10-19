# Spec: pty-backend (`pty-backend`)

## Objective

Terminais reais no Windows via ConPTY: spawn `powershell.exe` (ou comando do
preset dentro do shell persistente), streaming de output para o frontend,
injeção de env `MAESTRI_*`, ring 500 linhas p/ `check`, ask com timeout 30s,
idle 2s → evento de atenção. Espelha `SwiftTermProvider.swift` (env/launch),
`TerminalManager.swift` (ring/write), `TerminalActivityMonitor.swift` (idle),
`ScrollbackStore.swift` (JSONL em disco), adaptado p/ ConPTY + Tauri events.

## Tech Stack

- Rust: crate `portable-pty` 0.8 (ConPTY no Windows, sem build custom), threads
  p/ leitura, `tauri::Emitter` p/ `pty-output:{id}` / `pty-exit:{id}` / `pty-idle:{id}`
- Frontend: `xterm` npm (+ `@xterm/addon-fit`) dentro do `TerminalNode`
  (fiação em `node-terminal` pós-backend; aqui só o backend + comandos)
- Sem PTY no vitest; testes Rust cobrem ring/env/protocolo

## Commands

```powershell
npm test
npm run build
# src-tauri (com env MSVC do README):
cargo test pty
cargo add portable-pty --version 0.8   # se ainda não presente
```

## Project Structure

```
src-tauri/src/
  pty.rs            → NOVO: PtyManager (spawn/write/kill/read-loop), ring 500,
                      debounce flush 8s p/ terminals/{id}.scrollback (JSONL),
                      idle 2s, env MAESTRI_*, responseTimeout 30s p/ ask
  ipc.rs            → ask/check reais (usa PtyManager; mantém stub sem PTY)
  lib.rs            → registra pty_spawn/pty_write/pty_resize/pty_kill
tests/ (rust)       → ring, env build, parse de scrollback legado
```

## Code Style

Comandos finos, estado no `PtyManager` atrás de `Mutex`:

```rust
#[tauri::command]
pub fn pty_spawn(terminal_id: String, command: String, cwd: String, cols: u16, rows: u16,
                 state: tauri::State<'_, PtyState>) -> Result<(), String>;
#[tauri::command]
pub fn pty_write(terminal_id: String, data: String, state: tauri::State<'_, PtyState>) -> Result<(), String>;
```

Eventos: `pty-output:{terminal_id}` (chunk string), `pty-exit:{id}` (code),
`pty-idle:{id}` (após 2s sem output com task ativa). Env injetado:
`MAESTRI_TERMINAL_ID`, `OMAESTRI_TERMINAL_ID`, `MAESTRI_SOCKET=127.0.0.1:PORT`,
`MAESTRI_CLI=<sidecar omaestri.exe>`, `TERM=xterm-256color`. Comando de agente
roda dentro de shell persistente (`powershell -NoLogo`), como o Mac faz com zsh.

## Testing Strategy

- Rust `cargo test pty`: ring 500 (evict), flush/recuperação JSONL, env contém
  as 5 vars, ask-timeout constante 30s, idle dispara só com `hasActiveTask`.
- Smoke: criar terminal Shell no canvas → prompt PowerShell aparece;
  `omaestri check` via sidecar retorna output; matar shell → exit event.

## Boundaries

- Always: localhost-only mantido; `ask` injeta `prompt+\r` e espera idle/timeout
  sem travar o servidor (thread por ask); scrollback atômico (reuse `atomic_write`).
- Ask first: nova crate além de `portable-pty`; mudar eventos.
- Never: shell fora de ConPTY (sem `cmd /c` direto); bloquear loop do IPC;
  vazar handle de processo (kill no drop); `TERM` diferente de xterm-256color.

## Success Criteria

1. [ ] `pty_spawn powershell` → output chega em <1s no frontend via evento.
2. [ ] Env: `MAESTRI_TERMINAL_ID` + `MAESTRI_SOCKET=127.0.0.1:PORT` presentes
      (`$env:MAESTRI_SOCKET` no shell prova).
3. [ ] `omaestri check "<nome>"` retorna últimas 20 linhas (ring).
4. [ ] `omaestri ask "<nome>" "prompt"` injeta e retorna resposta ou timeout 30s.
5. [ ] Idle 2s após output com task ativa → evento + dot de atenção no nó.
6. [ ] Resize propaga (colunas/linhas); kill fecha sem zumbi; scrollback JSONL
      persiste e recarrega 5000 linhas.
7. [ ] `cargo test pty` verde, `npm test` verde, sem regressão E2E anterior.

## Open Questions

Nenhuma. `portable-pty` 0.8 é a escolha (ConPTY estável, sem cc custom);
xterm.js fiação visual fica em `node-terminal` pós-backend.

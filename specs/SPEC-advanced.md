# Spec: advanced (`advanced`)

## Objective

Paridade com o estado **parcial** do Mac (`product.md:50-52`): Floors (git
worktree: criar/remover/land + hooks, sem 3D), Routines (CRUD + scheduler com
`&&` chains disparando `pty.ask`, sem UI de indicador pulsante além de badge),
SSH (tela de config que persiste prefs; túneo real fora de escopo como no Mac).
Tudo via git CLI / threads Rust / prefs existentes.

## Tech Stack

Rust `advanced.rs` (floors via git CLI, routines.json + scheduler thread,
ssh = prefs). TS `Floors.tsx`/`Routines.tsx` modais simples. Sem deps.

## Commands

```powershell
npm test
npm run build
# src-tauri com env MSVC:
cargo test advanced
```

## Project Structure

```
src-tauri/src/
  advanced.rs         → NOVO: floor_create/remove/land/hooks_list,
                      routine CRUD + tick thread -> pty.ask,
                      routines.json {routines|payload}
  lib.rs              → registra 8 commands
src/shell/
  Floors.tsx          → NOVO: botão + modal (lista, new, land, remove, hooks view)
  Routines.tsx        → NOVO: botão + modal (lista, new, pause/resume, delete)
tests/
  advanced.test.ts    → NOVO: parse && chains, valid intervals
```

## Code Style

Routine tick: thread Rust por routine ativa; cada intervalo chama
`pty.ask(target, next_prompt)` com rotação de prompts; pausa em erro 3x
seguidas (evita loop infinito). Hooks Floor: `powershell -Command` com
`OMAESTRI_*` env (espelha Mac `/bin/zsh -c`).

## Testing Strategy

- Rust: `split_prompts("a && b")` == 2; routines.json tolera `routines` e `payload`.
- TS: valida intervalo mínimo 60s.
- Smoke: floor cria worktree real; routine dispara ask no terminal; SSH salva prefs.

## Boundaries

- Always: floor exige git repo (erro honesto); land = fetch + merge --no-ff;
  remove = worktree remove --force; routine min 60s.
- Ask first: SSH tunnel real.
- Never: `git push --force`; apagar branch no land; rodar hook sem mostrar output.

## Success Criteria

1. [ ] Floors: new (nome+branch) → `git worktree add -b`; lista do payload
      `floors`; land; remove; hooks view + Run (powershell + env).
2. [ ] Routines: new (nome+prompt com && + intervalo + alvo), pause/resume,
      delete; tick dispara ask de verdade; persiste `routines.json`.
3. [ ] SSH: tab em Settings com host/user/port/enable persistindo prefs
      (túnel real = fora, como no Mac).
4. [ ] Testes verdes, build limpo.

## Open Questions

Nenhuma.

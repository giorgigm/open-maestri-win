# Capability Map — open-maestri-win visual parity

> Decisão aprovada: paridade estrita com o Mac implementado, UI primeiro (ConPTY depois).
> Ombro excluído (o próprio Mac exclui — `product.md:53`).

| Module id | Responsibility | Depends on | Status |
|---|---|---|---|
| `workspace-store` | manifest, multi-workspace CRUD, folders/groups, paths Windows | — | parcial (store.rs single-ws) |
| `ipc-cli` | `POST /cli` + `omaestri.exe` — pronto F1/F2, sem spec | `workspace-store` | pronto |
| `app-shell` | sidebar + pill de ferramentas + zoom/minimap + menus dark | `workspace-store` | pronto |
| `canvas-core` | pan/zoom, drag/resize/duplicate/delete, snap, seleção, rope render | `app-shell` | pronto |
| `node-terminal` | nó terminal + modal New Terminal + presets + roles + Maestro | `canvas-core` | pronto |
| `pty-backend` | ConPTY + scrollback + idle + ask/check (F4) | `ipc-cli` | pronto |
| `node-note` | Raw/Formatted, rename/move-to, drag-in, note chains | `canvas-core` | — |
| `connections` | fluxo tecla L, 5 tipos, animação rope | `canvas-core` | — |
| `node-portal` | chrome browser + automação (F5 WebView2 estágio 2) | `canvas-core` | — |
| `node-filetree` | list/grid + Git parcial como no Mac | `canvas-core` | — |
| `settings` | General/Agents/Terminal/Shortcuts/Data | `app-shell` | — |
| `advanced` | Floors + Routines + SSH no estado parcial do Mac | `workspace-store` | — |

Build order: `workspace-store` → `app-shell` → `canvas-core` → `node-terminal` + `pty-backend` → `node-note` → `connections` → `node-portal` → `node-filetree` → `settings` → `advanced`.

Métrica 99%: checklist em `specs/PARITY-CHECKLIST.md` (derivado de `docs/reference/maestri-reference-index.md` §1–15 menos §13 Ombro). Score = itens OK / total. Alvo ≥ 99% dos itens que o Mac tem como Implemented.

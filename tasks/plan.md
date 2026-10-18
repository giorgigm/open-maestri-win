# Plan: app-shell

> Spec: `specs/SPEC-app-shell.md`. Só começar após spec aprovada (aprovada em 2026-10-18).

## Componentes e dependências

```
manifest.rs (Rust) ──→ manifest.ts (TS) ──→ Sidebar + NewWorkspaceModal
                                              │
App.tsx ──→ AppShell grid ──→ CanvasView (App.tsx atual, extraído)
              ├── ToolPill (modo ferramenta no App state)
              ├── ZoomControls + minimap popover (reusa Minimap existente)
              └── ContextMenu dark (novo; canvas-core reusará p/ Delete etc.)
```

Ordem: backend primeiro (sem UI quebrada no meio), depois shell visual,
depois fiação (atalhos, troca de workspace, menu).

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| App.tsx monolítico (416 linhas) quebra ao extrair | Extrair `CanvasView` sem mudar lógica; `tsc` + smoke `tauri dev` a cada slice |
| Divergência manifest vs Mac | Testes Rust + TS contra `AppState+Models.swift` campo-a-campo |
| Atalhos conflitam com input/terminal | Atalhos globais ignorados quando foco em `input/textarea/[contenteditable]` |
| Minimap popover vs fixo | Reusar componente `Minimap` existente, só muda o container |

## Slices verticais (cada um commita verde)

1. **S1 manifest backend** — `manifest.rs` + 5 commands + testes Rust
2. **S2 manifest TS + testes** — `manifest.ts` + `app-shell.test.ts`
3. **S3 AppShell grid + Sidebar** — layout, busca, troca de workspace E2E
4. **S4 ToolPill + modos** — 8 ferramentas, L/P/Esc, duplo-toolbar add removido
5. **S5 ZoomControls + minimap popover** — move minimap, `− % +`, popover
6. **S6 ContextMenu dark + atalhos** — menu genérico + 6 atalhos + duplicate
7. **S7 Polish + checklist** — abrir-no-editor, modal new/edit workspace, review contra home.png

S1+S2 podem ir em sequência rápida (mesmo autor); S3–S7 estritamente em ordem
(S4 precisa do grid; S6 precisa da seleção do canvas).

## Checkpoints

- Após S2: `npm test` + `cargo test` verdes
- Após S3: `tauri dev` abre com sidebar funcional, workspace troca e persiste
- Após S6: todos os 7 success criteria da spec marcados
- S7: commit final + atualização do CAPABILITY-MAP (`app-shell` → pronto)

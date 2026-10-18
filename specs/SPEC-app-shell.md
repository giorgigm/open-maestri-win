# Spec: app-shell (`app-shell`)

## Objective

Recriar o shell da janela open-maestri no Windows (Tauri 2 + React 19 + TS):
sidebar de workspaces à esquerda, pill de ferramentas no topo-centro, controles
de zoom + minimap no canto inferior-direito, menus de contexto dark. O canvas
atual (F3) continua funcionando por baixo; esta spec veste o app como o Mac
(`docs/images/home.png`), sem mudar protocolo IPC nem formato workspace.json.

Usuário: dev Windows rodando agentes no canvas. Sucesso: abrir o app e
reconhecer o layout do Mac à primeira vista; trocar de workspace pela sidebar;
zoom % clicável; menu dark com Delete em vermelho.

## Tech Stack

- React 19.1 + TypeScript strict (`tsconfig.json` atual) + CSS modules puros
  (sem Tailwind/Radix nesta fase — pill/menus são componentes próprios)
- Tauri 2 commands Rust para manifest + sidebar-layout + app-state
- Ícones: inline SVG próprio (estilo line-icon do print), sem emoji

## Commands

```powershell
npm install          # deps
npm test             # vitest run (contrato schema + novos testes shell)
npm run build        # tsc && vite build
npm run tauri dev    # app desktop (requer env MSVC — ver README.md)
```

## Project Structure

```
src/
  App.tsx              → monta AppShell; canvas atual vira <CanvasView>
  shell/
    AppShell.tsx       → grid: sidebar | canvas | overlays
    Sidebar.tsx        → busca + lista workspaces + modal new/edit
    ToolPill.tsx       → Select/Terminal/Note/Text/Drawing/File/Portal/Connection
    ZoomControls.tsx   → − % + + camadas + minimap popover
    ContextMenu.tsx    → menu dark genérico (Duplicate/Edit/Assign Role/
                         Enable Maestro/Connect/Delete)
    NewWorkspaceModal.tsx
  lib/
    workspace-schema.ts (existe)
    viewport.ts (existe)
    rope.ts (existe)
    manifest.ts        → NOVO: tipos WorkspaceEntry/SidebarLayout/AppStateData
src-tauri/src/
  store.rs (existe: workspace.json)
  manifest.rs          → NOVO: manifest.json + sidebar-layout.json + app-state.json
tests/
  workspace-schema.test.ts (existe)
  app-shell.test.ts    → NOVO: decode manifest/entry/layout, ordenação, atalhos
specs/
  SPEC-app-shell.md (este arquivo)
```

## Code Style

Componentes funcionais, props tipadas, CSS por módulo shell em
`src/shell/*.css` com tokens:

```css
:root {
  --om-bg: #f4f4f5;
  --om-panel: rgba(255, 255, 255, 0.92);
  --om-border: #e4e4e7;
  --om-text: #18181b;
  --om-muted: #71717a;
  --om-accent: #3b82f6;
  --om-danger: #ef4444;
  --om-menu-bg: rgba(24, 24, 27, 0.94);
}
```

Exemplo de shape (seguir):

```tsx
export interface ToolId { /* "select" | "terminal" | ... */ }
export function ToolPill({ active, onPick }: { active: ToolId; onPick: (t: ToolId) => void }) {
  return (
    <div className="om-pill" role="toolbar" aria-label="Canvas tools">
      {TOOLS.map((t) => (
        <button key={t.id} className={t.id === active ? "on" : ""} title={`${t.label} (${t.hint})`} onClick={() => onPick(t.id)}>
          {t.icon}
        </button>
      ))}
    </div>
  );
}
```

## Testing Strategy

- vitest (`tests/`): decode tolerante de `WorkspaceEntry` (sem `color` → `"blue"`),
  ordenação `topLevelItems` + grupos, serialização `SidebarLayout` V2, mapa de
  atalhos (L, P, Esc, Ctrl+W, Ctrl±, `\`).
- Sem testes de pixel nesta fase; verificação visual é manual no `tauri dev`
  contra `docs/images/home.png` (checklist na seção Success Criteria).
- `npm run build` (tsc) deve passar sem `any` novo.

## Boundaries

- Always: reutilizar `decodeWorkspaceDocument`/frame codec; comandos Tauri novos
  com prefixo `ws_`/`manifest_`; atalhos Windows (`Ctrl`, não `Cmd`); persistir
  layout/manifest em write atômico (reusar `store::atomic_write`).
- Ask first: nova dependência npm/crate; mudar `schemaVersion` ou nome de campo
  JSON; mexer no fio `POST /cli`.
- Never: quebrar compat `workspace.json`/`manifest.json` com o Mac; imitar
  traffic-lights macOS; commitar segredo; remover teste que falha sem aprovação.

## Success Criteria

Paridade visual verificável contra `home.png` (marcar cada um no review):

1. [ ] Sidebar fixa ~230px, busca "Search Workspaces", item com ícone + nome +
      path, badge de contagem; `+` abre modal (diretório obrigatório).
2. [ ] Pill topo-centro com 8 ferramentas (Select/Terminal/Note/Text/Drawing/
      File/Portal/Connection) + hints; `L` com terminal selecionado entra em
      modo conexão; `P` abre New Portal; `Esc` volta a Select.
3. [ ] Zoom bottom-right: `− % +`, botões camadas + minimap popover (minimap
      atual vira popover, não mais fixo).
4. [ ] Menu contexto dark: fundo `rgba(24,24,27,.94)`, raio 8px, grupos
      Duplicate/Edit | Assign Role/Enable Maestro (terminal) | Connect |
      Delete vermelho; fecha em Esc/clique-fora; posição com clamp no viewport.
5. [ ] Multi-workspace real: manifest lista 2+ workspaces, troca preserva
      canvas de cada um (load/save por id), `manifest.json` no formato Mac
      (`schemaVersion:1, type:"appState", dataFormat:2`).
6. [ ] Atalhos Windows: `Ctrl+W` deleta, `Ctrl+/-/=` zoom, `\` foca seleção,
      `Ctrl+↑/↓` troca workspace, `Ctrl`+drag = duplicate.
7. [ ] Nenhuma regressão: `npm test` 100% verde, `cargo test` 4/4, IPC/CLI E2E
      (`debug`, `list`, `note`) continua passando.

## Open Questions

1. Ícones: desenhar set próprio (atual: inline SVG) vs importar Lucide — default:
   inline SVG próprio, zero deps. OK?
2. "Abrir no editor" (botão canto superior-direito do Mac) entra nesta spec ou
   fica para `settings`? Proposta: entra aqui via `plugin-opener` (1 command).
3. Onboarding (primeira execução) replica o do Mac nesta fase ou depois?
   Proposta: depois (módulo `settings`).

# Spec: node-terminal (`node-terminal`)

## Objective

Nó Terminal com paridade visual/funcional ao Mac (`reference-index.md` §4 +
`Terminal/` 13 arquivos + `NewTerminalSheet.swift`): header com ícone/cor/nome +
badge `⌘n`/role + dot de atenção, footer com cwd, modal New Terminal (5 presets,
tabs Details/Appearance/Roles, Maestro toggle), context menu (Edit/Assign
Role/Enable Maestro/Connect/Delete), preset real gravado no `TerminalContent`
(shell Windows: `powershell.exe` p/ Shell, comando do preset p/ agentes).
PTY real é `pty-backend` (depois); aqui o corpo mostra status + comando + hint.

## Tech Stack

React 19 + TS strict, CSS em `src/shell/shell.css` (adições). Sem deps novas.
Presets espelham `Preferences.swift:86-103` (nomes/cores/comandos; Shell →
`powershell.exe` no Windows).

## Commands

```powershell
npm test
npm run build
npm run tauri dev
```

## Project Structure

```
src/nodes/
  TerminalNode.tsx      → NOVO: header/body/footer do nó
  NewTerminalModal.tsx  → NOVO: modal 400px (presets + 3 tabs)
src/lib/
  presets.ts            → NOVO: 5 presets + roles stub
src/canvas/CanvasView.tsx → usa TerminalNode no lugar do placeholder
tests/
  presets.test.ts       → NOVO
```

## Code Style

Modal segue o `WorkspaceModal` existente (`.om-modal-back` / `.om-modal`):

```tsx
export interface NewTerminalSpec {
  preset: AgentPreset;
  roleId: string | null;
  isManager: boolean;
  workingDirectory: string;
  name: string;
}
export function NewTerminalModal({ onCancel, onCreate }: {
  onCancel: () => void;
  onCreate: (spec: NewTerminalSpec) => void;
}) { /* tabs Details | Appearance | Roles */ }
```

Header do nó: `[icon] name [role-badge] [attention-dot]`; footer: `cwd` +
`status`. Badge numérico `Ctrl+1..9` por ordem de criação (espelha `⌘`+número).

## Testing Strategy

- `tests/presets.test.ts`: 5 presets presentes, `agentType` válidos, Shell com
  `shellPath powershell.exe`, cores hex válidas.
- Smoke: criar terminal por ferramenta e por pill; modal com presets; Maestro
  toggle reflete `isManager`; badge ordenado; menu do nó com itens do Mac.

## Boundaries

- Always: gravar `TerminalContent` completo e válido (schema); `shellPath`
  Windows (`powershell.exe`); `command` do preset; respeitar `isLocked`.
- Ask first: nova dep; mudar schema.
- Never: PTY real (é `pty-backend`); terminal funcional falso que pareça
  conectado (mostrar "aguardando PTY" honesto); Cmd nos hints (Ctrl).

## Success Criteria

1. [ ] Nó terminal: header ícone/cor/nome + badge número + role + dot atenção;
      footer cwd + status; corpo: comando + hint PTY (honesto, sem fake).
2. [ ] Modal New Terminal 400px: 5 presets Quick Start (troca atualiza
      nome+comando); tabs Details/Appearance/Roles; Monitor Activity default on;
      Maestro toggle; dir com Choose (dialog nativo Tauri); Cancel/Create.
3. [ ] Criar via drag-to-place abre o modal; confirmar cria nó com preset real;
      cancelar não cria nada.
4. [ ] Menu do nó: Duplicate / Edit Terminal / Assign Role / Enable Maestro
      (toggle reflete `isManager`) / Connect / Delete vermelho.
5. [ ] `Ctrl+1..9` foca o terminal correspondente (scroll viewport p/ ele).
6. [ ] `npm test` verde, `npm run build` limpo, sem regressão.

## Open Questions

Nenhuma. Roles: stub local (lista fixa Lead/Coder/Reviewer/Tester do §4) até
`settings`; tab Roles permite pick/unassign.

# Spec: connections (`connections`)

## Objective

Fluxo de conexão no canvas com paridade Mac (`reference-index.md` §6 +
`ConnectionManager.swift`): tecla `L` / ferramenta Connection / menu Connect
entram em modo connect (crosshair + linha fantasma do source ao cursor); clicar
num nó válido cria a conexão do tipo certo (5 tipos); Esc cancela; conexões
persistem no payload; deletar nó remove suas conexões; rope renderiza todos os
5 tipos (loop atual só cobre 3).

## Tech Stack

React + TS, sem deps. Tipos de conexão já existem em `workspace-schema.ts`.

## Commands

```powershell
npm test
npm run build
npm run tauri dev
```

## Project Structure

```
src/canvas/CanvasView.tsx → modo connect (source, ghost line, click alvo)
src/App.tsx               → createConnection(from,to) por tipo + cleanup no delete
```

## Code Style

Validação de par (espelha `isConnectable` + tipos do Mac):

```ts
function pairKind(a: NodeVariant, b: NodeVariant):
  | "terminal" | "note" | "portal" | "portalToPortal" | "noteToNote" | null {
  const pair = [a, b].sort().join("+");
  // terminal+terminal, terminal+stickyNote, terminal+portal,
  // portal+portal, stickyNote+stickyNote — resto: null
}
```

Terminal é identificado por node id OU `TerminalContent.id` (conexões do Mac
usam o content id). Duplicata (mesmo par+tpo) não cria de novo.

## Testing Strategy

- `tests/connections.test.ts`: matriz 5 tipos válidos + 4 inválidos
  (text/fileTree/drawing com qualquer coisa), duplicata, terminal por content-id.
- Smoke: L com terminal → click note = noteConnection persistida (restart
  mantém); Esc cancela; delete nó limpa ropes.

## Boundaries

- Always: ghost line do centro do source ao cursor; cursor crosshair;
  clique no vazio cancela; rope default = 21 pts zerados (Mac
  `buildDefaultRopePoints`); delete de nó faz `disconnectAll`.
- Ask first: mudar formato.
- Never: conectar nó a si mesmo; fileTree/text/drawing como endpoint;
  dois connects simultâneos.

## Success Criteria

1. [ ] `L`/pill/Connect entram em modo connect a partir da seleção (terminal,
      note ou portal); Esc/click-vazio cancela.
2. [ ] 5 tipos criados corretamente: T↔T, T↔Note, T↔Portal, N↔N, P↔P; inválidos
      mostram status "cannot connect" e não criam.
3. [ ] Ropes renderizam os 5 tipos (noteToNote e portalToPortal incluídos).
4. [ ] Persistência: restart mantém conexões; delete de nó remove as suas.
5. [ ] `omaestri list` reflete conexões (registry já lista; validar E2E).
6. [ ] `npm test` verde, build limpo.

## Open Questions

Nenhuma.

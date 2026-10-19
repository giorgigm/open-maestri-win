# Spec: canvas-core (`canvas-core`)

## Objective

Completar o motor do canvas até a paridade com o Mac (`maestri-reference-index.md` §3
+ `Canvas/` 37 arquivos): drag-to-place, resize por handles, duplicate via
Ctrl+drag, magnetic snap via Alt+drag, multi-seleção + multi-drag, rope com cor
de status, delete de conexão via right-click, seleção com borda tracejada. O
`CanvasView.tsx` atual já tem pan/zoom/drag/rope/minimap — esta spec eleva o
nível de interação, sem tocar IPC, manifest ou nós específicos.

## Tech Stack

React 19 + TS strict, SVG para ropes + guias de snap, CSS em `src/shell/shell.css`
(adições) ou `src/canvas/canvas.css` novo. Sem deps novas.

## Commands

```powershell
npm test             # vitest
npm run build        # tsc && vite build
npm run tauri dev    # smoke visual
```

## Project Structure

```
src/canvas/
  CanvasView.tsx     → props novas (ver Code Style)
  snap.ts            → NOVO: wall-align + gap-fill puros (testável)
  canvas.css         → NOVO: handles, rubber-band, guias, dashed
tests/
  snap.test.ts       → NOVO: casos de alinhamento/fenda
```

## Code Style

Lógica de snap 100% pura e testada (coordenadas canvas, sem DOM):

```ts
export interface SnapResult { dx: number; dy: number; guides: Guide[] }
export function snapRect(moving: FrameRect, others: FrameRect[], tol: number): SnapResult;
```

CanvasView recebe callbacks (shell continua dona do doc):

```tsx
onDuplicateNode: (id: string) => string;   // retorna id do clone
onDeleteConnection: (connId: string) => void;
onRenameNode?: (id: string) => void;
```

Handles: 8 (cantos + arestas), 10px screen, mínimo terminal 200×100,
nota 120×80, demais 60×40 (espelha `Constants.swift:24-27`).

## Testing Strategy

- `tests/snap.test.ts`: alinha esquerda/direita/centro, tolerância, gap-fill
  centralizado, sem snap além da tolerância, múltiplos candidatos (menor delta).
- Smoke manual: cada success criterion abaixo no `tauri dev`.

## Boundaries

- Always: coordenadas canvas na lógica, screen só na render; frame persiste em
  `[[x,y],[w,h]]` via `rectToFrameArray`; respeitar `isLocked` (nó travado não
  move/resize); rope delete só via right-click na linha (tolerância 6px screen).
- Ask first: nova dep; mudar formato persistido.
- Never: quebrar `workspace-schema.ts`; snap em grade fixa (Mac é sem-grid);
  atalhos com Cmd (Windows = Ctrl); roubar eventos de input/terminal.

## Success Criteria

1. [ ] Drag-to-place: com ferramenta de criação ativa, arrastar no canvas mostra
      rubber-band e cria o nó naquele rect; clique simples (<4px) cria tamanho default.
2. [ ] Resize: nó selecionado mostra 8 handles; arrastar redimensiona (com mín.).
3. [ ] Duplicate: Ctrl+mousedown num nó clona e arrasta o clone (offset +24 canvas).
4. [ ] Magnetic snap: Alt+drag alinha a paredes/centros/gap de vizinhos (tol 6px
      screen), mostra guia azul; sem Alt, livre.
5. [ ] Multi-seleção: Shift+click adiciona/remove; drag move todos; Esc limpa.
6. [ ] Rope status: terminal `running` → verde, senão cinza (portal `loading` → verde).
7. [ ] Right-click numa rope abre menu dark com Delete (vermelho) que remove a conexão.
8. [ ] Seleção com borda tracejada (Mac §3 "虚线边框"), não sólida.
9. [ ] `npm test` verde (inclui `snap.test.ts`), `npm run build` limpo, sem regressão IPC/CLI.

## Open Questions

Nenhuma — decisões tomadas: Alt+drag = snap (Ctrl já é duplicate), tolerância
6px screen, gap-fill = centralizar no vão entre dois vizinhos.

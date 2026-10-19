# Todo: canvas-core

- [ ] C1 snap.ts + snap.test.ts
  - Acceptance: wall-align (L/C/R, T/C/B), tolerância, gap-fill H/V, menor delta vence
  - Verify: `npm test`
  - Files: `src/canvas/snap.ts`, `tests/snap.test.ts`
- [ ] C2 drag-to-place + resize + rope status/delete + dashed
  - Acceptance: rubber-band cria nó no rect; 8 handles com mínimos; rope verde/dashed; right-click rope deleta; seleção tracejada
  - Verify: `npm run build` + smoke
  - Files: `src/canvas/CanvasView.tsx`, `src/App.tsx`, `src/App.css`
- [ ] C3 duplicate + multi-select + Alt-snap
  - Acceptance: Ctrl+drag clona; Shift+click multi; drag move todos; Alt+drag snap com guia
  - Verify: smoke + `npm test`
  - Files: `src/canvas/CanvasView.tsx`, `src/App.tsx`

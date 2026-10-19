# Spec: node-portal (`node-portal`)

## Objective

Nó Portal com paridade visual Mac (`reference-index.md` §10): chrome de
browser (traffic-safe: barra URL + back/forward/reload), área de página,
status idle/loading, New Portal via `P`/pill (modal URL+nutzung nome). Estágio 1
usa `<iframe>` (limitação honesta: sites com X-Frame-Options mostram fallback;
automação JS só same-origin). Estágio 2 (fora desta spec): WebView2 dedicada
por portal via multi-window Tauri + `ExecuteScriptAsync` p/ os 26 subs.

## Tech Stack

React + TS. Sem deps. CLI `portal navigate` atualiza `currentURL` (resolve
name→portal de verdade — corrige bug Mac `resolvePortalId` que ignora o nome).

## Commands

```powershell
npm test
npm run build
npm run tauri dev
```

## Project Structure

```
src/nodes/
  PortalNode.tsx      → NOVO: chrome + url bar + iframe + fallback
  NewPortalModal.tsx  → NOVO: URL + nome
src/App.tsx           → modal P/pill, update URL, delete
src-tauri/src/ipc.rs  → portal navigate/back/forward/reload/snapshot/info
                        com resolve por nome (fix Mac)
```

## Code Style

```tsx
export default function PortalNode({ content, onNavigate }: {
  content: PortalContent;
  onNavigate: (url: string) => void;
}) {
  const [draft, setDraft] = useState(content.currentURL);
  const [blocked, setBlocked] = useState(false);
  // iframe onLoad -> loading=false; timeout 15s sem load -> blocked=true (X-Frame)
}
```

## Testing Strategy

- `tests/portal.test.ts`: resolve por nome (exact/fuzzy/unknown), valida URL
  (http/https/localhost), normaliza sem-esquema → `https://`.
- Smoke: P → modal → github.com mostra fallback honesto; localhost:1420
  renderiza; back/forward/reload funcionam; `omaestri portal navigate` muda URL.

## Boundaries

- Always: URL bar com Enter; loading spinner; fallback X-Frame honesto
  ("site bloqueia embed — estágio 2 usa WebView2 nativa"); `source.url._0`
  sincronizado com `currentURL`.
- Ask first: multi-window (estágio 2).
- Never: fingir automação cross-origin; http inseguro sem aviso.

## Success Criteria

1. [ ] Chrome: barra URL editável + back/forward/reload + status; iframe preenche.
2. [ ] Modal New Portal (URL + nome opcional); `P`/pill abrem; Enter cria.
3. [ ] Fallback honesto p/ X-Frame-Options com link "abrir no browser".
4. [ ] CLI: `portal navigate/info` com resolve por nome; `snapshot` retorna
      aviso honesto (estágio 2) em vez de erro genérico.
5. [ ] `npm test` verde, build limpo.

## Open Questions

Nenhuma.

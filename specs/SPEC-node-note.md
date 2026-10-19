# Spec: node-note (`node-note`)

## Objective

Nó Note com paridade ao Mac (`reference-index.md` §5 + `Note/` 7 arquivos):
header `[Raw|Formatted] nome [⋯]`, corpo Raw (textarea) / Formatted (preview
renderizado), rename (custom name), delete exclui `.md`, toggle de vista
persistido em `isPreviewing`, note chains (note↔note via connections pronta).
Arquivos em `workspaces/{id}/notes/` (managed) — o backend `note read/write`
já existe no `ipc.rs`.

## Tech Stack

React 19 + TS, textarea nativo + render markdown próprio mínimo
(headings/bold/code/links/listas — sem dep; `marked` só se o mínimo provar
insuficiente). Tauri commands `note_load`/`note_save` (Rust lê/escreve .md
atômico). Sem deps novas (decisão).

## Commands

```powershell
npm test
npm run build
npm run tauri dev
```

## Project Structure

```
src/nodes/
  NoteNode.tsx        → NOVO: header toggle + Raw/Formatted + rename inline
src-tauri/src/
  lib.rs              → note_load/note_save (2 commands, reuse atomic_write)
tests/
  note-format.test.ts → NOVO: renderer mínimo (7 casos)
```

## Code Style

```tsx
export default function NoteNode({ node, workspaceId, onRename }: {...}) {
  const [mode, setMode] = useState(content.isPreviewing ? "view" : "raw");
  // debounce 500ms -> invoke note_save; toggle persiste isPreviewing no doc
}
```

Renderer mínimo puro (sem regex catastrófico, escapa HTML primeiro).

## Testing Strategy

- `tests/note-format.test.ts`: heading, bold, inline code, code fence, link,
  list, escape HTML.
- Smoke: criar note via pill, digitar, toggle, restart preserva; rename muda
  header; delete remove `.md`.

## Boundaries

- Always: debounce save 500ms; `fileName` com `.md`; custom path fora de
  `notes/` só via Move-to (fica p/ settings — aqui managed).
- Ask first: dep `marked`; mudar formato.
- Never: perder conteúdo (save antes de trocar de ws/desmontar); XSS (escapar).

## Success Criteria

1. [ ] Header: `[Raw|Formatted]` toggle + nome + `⋯` (Rename/Delete no menu).
2. [ ] Raw edita com debounce; Formatted renderiza headings/bold/code/links/listas.
3. [ ] Toggle persiste `isPreviewing`; restart restaura modo + conteúdo.
4. [ ] Rename inline (duplo-click) com custom name; Delete exclui `.md` + nó.
5. [ ] `omaestri note read` com formato `[N lines total]` + linhas numeradas
      (igual Mac `readWithLineRange`); `offset/limit` funcionam (gap F1 corrigido).
6. [ ] `npm test` verde, build limpo, sem regressão.

## Open Questions

Nenhuma. Paste de imagem e drag-in de `.md` ficam p/ `node-filetree`/polish.

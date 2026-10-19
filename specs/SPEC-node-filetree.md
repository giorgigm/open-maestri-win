# Spec: node-filetree (`node-filetree`)

## Objective

Nó File Tree com paridade ao estado do Mac (`reference-index.md` §7, status
"Partial" — browsing funciona, Git ops incompletas): toolbar (path + List/Grid
+ branch), lista lazy expansível, grid de ícones, badge de git status por
arquivo, painel diff `--stat` + diff de arquivo, botão Commit (stage-all +
message). Bloco "New Branch/Checkout/Push/Pull" fica p/ `advanced` com Floors.

## Tech Stack

React + TS; Rust `fs_list(path)` (nomes, dir?, tamanho, modificado) +
`git_status(root)` (porcelain) + `git_diff(root, path?)` + `git_commit(root,
message)` via `git` CLI do sistema. Sem deps novas.

## Commands

```powershell
npm test
npm run build
npm run tauri dev
```

## Project Structure

```
src-tauri/src/
  fs.rs               → NOVO: fs_list/git_status/git_diff/git_commit + tests
  lib.rs              → registra 4 commands
src/nodes/
  FileTreeNode.tsx    → NOVO: toolbar + list/grid + diff/commit
tests/
  filetree.test.ts    → NOVO: parse porcelain
```

## Code Style

Porcelain parse puro em TS também (reuso no teste):

```ts
export function parsePorcelain(out: string): Map<string, string>;
```

Git via CLI com `cwd=root`, timeout 15s, erro honesto se `git` ausente ou
fora de repo (nó mostra "not a git repo" e segue como browser puro).

## Testing Strategy

- Rust: `fs_list` num tempdir; `git_status` vazio em tempdir sem repo (erro
  honesto).
- TS: parse porcelain (modified/added/untracked/renamed).
- Smoke: FileTree em `C:\ia\open-maestri-win` lista arquivos; badge `M` após
  editar; diff mostra; commit funciona.

## Boundaries

- Always: lazy (1 nível por vez); symlink não seguido; path traversal guard;
  commit só com message não-vazia; diff capado em 200KB.
- Ask first: libgit2 no lugar do CLI.
- Never: `git clean/checkout --force`; expor `.git/` na lista.

## Success Criteria

1. [ ] Toolbar: path editável + List|Grid + branch atual (ou "no repo").
2. [ ] List lazy com expandir/colapsar + badge M/A/D/?/R; Grid com ícones por ext.
3. [ ] Click em arquivo mostra diff (cap 200KB); `--stat` no topo.
4. [ ] Commit: input + botão, stage-all implícito, erro honesto.
5. [ ] Fora de repo: browser puro, sem badge, sem diff.
6. [ ] `npm test` + `cargo test` verdes, build limpo.

## Open Questions

Nenhuma.

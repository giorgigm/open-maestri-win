# Spec: settings (`settings`)

## Objective

Janela Settings com paridade Mac (`Settings/` 6 arquivos + `Preferences.swift`
22 campos): tabs General / Agents / Terminal / Shortcuts / Data.
`preferences.json` em Rust (defaults Swift + decode tolerante) e TS; Agents
edita presets (toggle active) e roles CRUD (usados no modal); Terminal ajusta
fonte/tema do xterm ao vivo; Data abre pasta/exporta/wipe com confirmação.

## Tech Stack

React + TS; Rust `prefs.rs` (load/save `preferences.json`); commands
`prefs_load/prefs_save/data_dir_open/app_reset`. Sem deps.

## Commands

```powershell
npm test
npm run build
npm run tauri dev
```

## Project Structure

```
src-tauri/src/
  prefs.rs            → NOVO: Preferences (22 campos, serde camelCase) + tests
src/
  lib/preferences.ts  → NOVO: tipos + defaults + merge tolerante
  shell/Settings.tsx  → NOVO: modal 560px, 5 tabs
tests/
  preferences.test.ts → NOVO
```

## Code Style

Defaults TS espelham `Preferences.init()` campo a campo (Windows: Shell
preset command `""`, `preferredIDE` sem `xcode`, sem `metalRendererEnabled`/
`optionAsMeta` — documentados como `omitidas no Windows`).

## Testing Strategy

- Rust: defaults == Swift; legacy `{}` decoda; round-trip.
- TS: merge tolerante (faltando tudo → defaults; presets custom preservados).
- Smoke: abrir via botão ⚙ na sidebar; mudar tema → xterm escurece/clareia;
  desativar preset some do modal; role nova aparece no modal; Data export
  gera zip? Não — export = abre pasta (zip fora de escopo).

## Boundaries

- Always: `preferences.json` schemaVersion 1; presets built-in não deletáveis
  (só toggle); roles com id uuid; wipe pede digitar "DELETE".
- Ask first: nova dep (zip).
- Never: expor `sshScriptPath` Mac (`~/.local/bin`) — default Windows
  `%APPDATA%\open-maestri\omaestri.exe`; quebrar decode de prefs do Mac.

## Success Criteria

1. [ ] ⚙ abre Settings; 5 tabs; salva em `preferences.json` (formato Mac).
2. [ ] Agents: toggle preset reflete no New Terminal; roles CRUD refletem no
      modal + `role list` do CLI.
3. [ ] Terminal: font size/family + tema aplicados ao vivo nos xterms abertos.
4. [ ] General: IDE/note color/canvas bg/autosave aplicados (autosave re-arme timer).
5. [ ] Shortcuts: mapa readonly + Reset defaults.
6. [ ] Data: Open folder, Clear scrollbacks, Export workspace (copia json),
      Reset all (com confirmação digitada).
7. [ ] Testes verdes, build limpo.

## Open Questions

Nenhuma.

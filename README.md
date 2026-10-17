# open-maestri-win

Windows port of [open-maestri](https://github.com/pedrotecinf/open-maestri)
(macOS Swift/SwiftUI multi-agent orchestration canvas) — rewritten as
**Tauri 2 + React + Rust**. Upstream Swift repo stays untouched at
`C:\ia\open-maestri`; full port analysis at
`C:\ia\open-maestri\docs\windows-port-analysis.md`.

## Compat contract (do not break)

- `workspace.json` `schemaVersion: 2`, frame `[[x,y],[w,h]]`,
  `NodeContent` as `{variant:{_0:{...}}}`, camelCase, ISO8601 UTC
  (`src/lib/workspace-schema.ts`, tests in `tests/`)
- IPC wire-identical to Swift: `POST /cli HTTP/1.x` + `X-Terminal-ID` +
  `{"args":[...]}` on `127.0.0.1:<dynamic-port>`; plain-text body responses,
  `error: ` prefix on failure (`src-tauri/src/ipc.rs`)
- CLI `omaestri` identical interface (`sidecar/omaestri/`)

## Dev

```powershell
npm install
npm test            # vitest (schema contract)
npm run tauri dev   # needs MSVC Build Tools + WebView2 (both present)
```

MSVC env (BuildTools 2022 not on PATH by default):

```powershell
$msvc = Get-ChildItem "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC" | Select -First 1 -Expand FullName
$sdk = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\Lib" | Sort Name -Desc | Select -First 1 -Expand FullName
$env:Path = "$msvc\bin\Hostx64\x64;C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64;" + $env:Path
$env:LIB = "$msvc\lib\x64;$sdk\um\x64;$sdk\ucrt\x64"
$env:INCLUDE = "$msvc\include;C:\Program Files (x86)\Windows Kits\10\Include\10.0.26100.0\ucrt;...\um;...\shared"
```

## Status

- F0 scaffold + F1 schema/store/IPC + F3 canvas mínimo: done
- F2 CLI `omaestri.exe`: builds; needs live-app E2E
- F4 ConPTY terminals, F5 WebView2 portal, F6 FileTree/Git/packaging: pending

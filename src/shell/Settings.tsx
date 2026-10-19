import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { SHORTCUTS } from "../lib/manifest";
import { mergePreferences, type Preferences } from "../lib/preferences";

const TABS = ["General", "Agents", "Terminal", "Shortcuts", "SSH", "Data"] as const;

const THEMES = ["dark", "light", "dracula", "solarized-dark", "solarized-light", "nord", "one-dark", "tokyo-night"];

export default function Settings({
  initial,
  onClose,
  onChange,
}: {
  initial: Preferences;
  onClose: () => void;
  onChange: (p: Preferences) => void;
}) {
  const [prefs, setPrefs] = useState<Preferences>(mergePreferences(initial));
  const [tab, setTab] = useState<(typeof TABS)[number]>("General");
  const [confirmReset, setConfirmReset] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const set = (patch: Partial<Preferences>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    onChange(next);
    invoke("prefs_save", { prefs: next }).catch((e) => setMsg(String(e)));
  };

  const [roleName, setRoleName] = useState("");
  const [rolePrompt, setRolePrompt] = useState("");

  return (
    <div className="om-modal-back" onMouseDown={onClose}>
      <div className="om-modal om-settings" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <div className="om-tabs">
          {TABS.map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>

        {tab === "General" && (
          <div className="om-tab-body">
            <label>
              Preferred IDE
              <select value={prefs.preferredIDE} onChange={(e) => set({ preferredIDE: e.currentTarget.value })}>
                <option value="cursor">Cursor</option>
                <option value="vscode">VS Code</option>
              </select>
            </label>
            <label>
              Canvas background
              <select value={prefs.canvasBackground} onChange={(e) => set({ canvasBackground: e.currentTarget.value })}>
                <option value="dotGrid">Dot grid</option>
                <option value="solid">Solid</option>
                <option value="transparent">Transparent</option>
              </select>
            </label>
            <label>
              Default note color
              <input type="color" value={prefs.defaultNoteColor} onChange={(e) => set({ defaultNoteColor: e.currentTarget.value })} />
            </label>
            <label>
              Autosave interval (seconds)
              <input
                type="number"
                min={5}
                max={300}
                value={prefs.autosaveIntervalSeconds}
                onChange={(e) => set({ autosaveIntervalSeconds: Math.max(5, parseInt(e.currentTarget.value, 10) || 30) })}
              />
            </label>
          </div>
        )}

        {tab === "Agents" && (
          <div className="om-tab-body">
            <div className="om-qs-label">Presets (toggle visibility in New Terminal)</div>
            {prefs.agentPresets.map((a) => (
              <label key={a.id} className="om-check">
                <input
                  type="checkbox"
                  checked={a.isActive}
                  disabled={a.isBuiltIn && prefs.agentPresets.filter((x) => x.isActive).length === 1 && a.isActive}
                  onChange={(e) =>
                    set({ agentPresets: prefs.agentPresets.map((x) => (x.id === a.id ? { ...x, isActive: e.currentTarget.checked } : x)) })
                  }
                />
                <span className="om-dot" style={{ background: a.color, width: 14, height: 14 }} /> {a.name}
                <span className="om-muted">{a.command || "shell"}</span>
              </label>
            ))}
            <div className="om-qs-label">Roles</div>
            {prefs.rolePresets.map((r) => (
              <div key={r.id} className="om-role-row">
                <strong>{r.name}</strong>
                <span className="om-muted">{r.prompt.slice(0, 60)}</span>
                <button onClick={() => set({ rolePresets: prefs.rolePresets.filter((x) => x.id !== r.id) })}>Delete</button>
              </div>
            ))}
            <div className="om-role-new">
              <input value={roleName} onChange={(e) => setRoleName(e.currentTarget.value)} placeholder="Role name" />
              <input value={rolePrompt} onChange={(e) => setRolePrompt(e.currentTarget.value)} placeholder="Prompt…" />
              <button
                disabled={!roleName.trim()}
                onClick={() => {
                  set({
                    rolePresets: [
                      ...prefs.rolePresets,
                      { id: crypto.randomUUID(), name: roleName.trim(), prompt: rolePrompt, color: "#3b82f6", icon: "person" },
                    ],
                  });
                  setRoleName("");
                  setRolePrompt("");
                }}
              >
                Add
              </button>
            </div>
          </div>
        )}

        {tab === "Terminal" && (
          <div className="om-tab-body">
            <label>
              Font size
              <input
                type="number"
                min={8}
                max={24}
                value={prefs.terminalFontSize}
                onChange={(e) => set({ terminalFontSize: parseInt(e.currentTarget.value, 10) || 13 })}
              />
            </label>
            <label>
              Font family
              <input value={prefs.terminalFontFamily} onChange={(e) => set({ terminalFontFamily: e.currentTarget.value })} placeholder="system" />
            </label>
            <label>
              Theme
              <select value={prefs.terminalTheme} onChange={(e) => set({ terminalTheme: e.currentTarget.value })}>
                {THEMES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {tab === "Shortcuts" && (
          <div className="om-tab-body">
            {Object.entries(SHORTCUTS).map(([k, v]) => (
              <div key={k} className="om-role-row">
                <span>{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
            <div className="om-muted">Custom key editing lands with a future pass; defaults above are live.</div>
          </div>
        )}

        {tab === "SSH" && (
          <div className="om-tab-body">
            <label className="om-check">
              <input type="checkbox" checked={prefs.sshEnabled} onChange={(e) => set({ sshEnabled: e.currentTarget.checked })} />
              Enable SSH workspaces (config only — tunnel ships later, like the Mac scaffold)
            </label>
            <label>
              Host
              <input value={prefs.sshHost} onChange={(e) => set({ sshHost: e.currentTarget.value })} placeholder="example.com" />
            </label>
            <label>
              User
              <input value={prefs.sshUser} onChange={(e) => set({ sshUser: e.currentTarget.value })} placeholder="user" />
            </label>
            <label>
              Port
              <input type="number" value={prefs.sshPort} onChange={(e) => set({ sshPort: parseInt(e.currentTarget.value, 10) || 22 })} />
            </label>
            <label>
              Tunnel port
              <input type="number" value={prefs.sshTunnelPort} onChange={(e) => set({ sshTunnelPort: parseInt(e.currentTarget.value, 10) || 7433 })} />
            </label>
          </div>
        )}

        {tab === "Data" && (
          <div className="om-tab-body">
            <button onClick={() => invoke("data_dir_open").then(() => openPath("."))}>Open data folder</button>
            <button
              onClick={async () => {
                const ws = prefs; // keep ref for lint
                void ws;
                setMsg("Clear scrollbacks: delete terminals/*.scrollback in the data folder (per-ws wipe ships with Floors).");
              }}
            >
              Clear scrollbacks…
            </button>
            <label>
              Type DELETE to reset everything
              <input value={confirmReset} onChange={(e) => setConfirmReset(e.currentTarget.value)} placeholder="DELETE" />
            </label>
            <button
              className="danger"
              disabled={confirmReset !== "DELETE"}
              onClick={() => invoke("app_reset", { confirm: confirmReset }).then(() => window.location.reload()).catch((e) => setMsg(String(e)))}
            >
              Reset all data
            </button>
            {msg && <div className="om-muted">{msg}</div>}
          </div>
        )}

        <div className="om-modal-row">
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

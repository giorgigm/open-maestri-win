import { useState } from "react";
import { AGENT_PRESETS, BUILTIN_ROLES, type AgentPreset } from "../lib/presets";

export interface NewTerminalSpec {
  preset: AgentPreset;
  roleId: string | null;
  isManager: boolean;
  monitorActivity: boolean;
  workingDirectory: string;
  name: string;
}

const TABS = ["Details", "Appearance", "Roles"] as const;

export default function NewTerminalModal({
  defaultDir,
  onCancel,
  onCreate,
}: {
  defaultDir: string;
  onCancel: () => void;
  onCreate: (spec: NewTerminalSpec) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Details");
  const [name, setName] = useState(AGENT_PRESETS[0].name);
  const [command, setCommand] = useState(AGENT_PRESETS[0].command);
  const [monitor, setMonitor] = useState(true);
  const [maestro, setMaestro] = useState(false);
  const [dir, setDir] = useState(defaultDir);
  const [roleId, setRoleId] = useState<string | null>(null);

  const pick = (i: number) => {
    setIdx(i);
    setName(AGENT_PRESETS[i].name);
    setCommand(AGENT_PRESETS[i].command);
  };

  const create = () => {
    const preset = { ...AGENT_PRESETS[idx], name: name || AGENT_PRESETS[idx].name, command };
    onCreate({
      preset,
      roleId,
      isManager: maestro,
      monitorActivity: monitor,
      workingDirectory: dir || defaultDir,
      name: preset.name,
    });
  };

  return (
    <div className="om-modal-back" onMouseDown={onCancel}>
      <div className="om-modal om-modal-term" onMouseDown={(e) => e.stopPropagation()}>
        <h2>New Terminal</h2>
        <div className="om-qs-label">Quick Start</div>
        <div className="om-preset-row">
          {AGENT_PRESETS.map((p, i) => (
            <button key={p.id} className={`om-preset ${i === idx ? "on" : ""}`} onClick={() => pick(i)} title={p.command || "shell"}>
              <span className="om-preset-icon" style={{ borderColor: p.color, color: p.color }}>
                {p.name[0]}
              </span>
              <span className="om-preset-name">{p.name}</span>
            </button>
          ))}
        </div>
        <div className="om-tabs">
          {TABS.map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        {tab === "Details" && (
          <div className="om-tab-body">
            <label>
              Terminal Name
              <input value={name} onChange={(e) => setName(e.currentTarget.value)} autoFocus />
            </label>
            <label>
              Command
              <input value={command} onChange={(e) => setCommand(e.currentTarget.value)} placeholder="(empty = shell)" />
            </label>
            <label className="om-check">
              <input type="checkbox" checked={monitor} onChange={(e) => setMonitor(e.currentTarget.checked)} />
              👁 Monitor Activity
            </label>
            <label className="om-check">
              <input type="checkbox" checked={maestro} onChange={(e) => setMaestro(e.currentTarget.checked)} />
              ✨ Maestro
            </label>
            <label>
              Working Directory
              <input value={dir} onChange={(e) => setDir(e.currentTarget.value)} />
            </label>
          </div>
        )}
        {tab === "Appearance" && (
          <div className="om-tab-body">
            <div className="om-appear">
              <span className="om-dot" style={{ background: AGENT_PRESETS[idx].color }} />
              <div>
                <div className="om-appear-name">{AGENT_PRESETS[idx].name}</div>
                <div className="om-appear-type">{AGENT_PRESETS[idx].agentType}</div>
              </div>
            </div>
            <div className="om-muted">Theme and font follow Terminal settings (settings module).</div>
          </div>
        )}
        {tab === "Roles" && (
          <div className="om-tab-body">
            <button className={`om-role ${roleId === null ? "on" : ""}`} onClick={() => setRoleId(null)}>
              No role
            </button>
            {BUILTIN_ROLES.map((r) => (
              <button key={r.id} className={`om-role ${roleId === r.id ? "on" : ""}`} onClick={() => setRoleId(r.id)} title={r.prompt}>
                {r.name}
              </button>
            ))}
          </div>
        )}
        <div className="om-modal-row">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={create}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

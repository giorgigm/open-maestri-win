import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Routine {
  id: string;
  name: string;
  prompt: string;
  intervalSeconds: number;
  targetTerminalId: string;
  isActive: boolean;
}

export default function Routines({
  terminals,
  onClose,
}: {
  terminals: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [list, setList] = useState<Routine[]>([]);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [secs, setSecs] = useState(300);
  const [target, setTarget] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setList(await invoke<Routine[]>("routine_list"));
    } catch (e) {
      setMsg(String(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="om-modal-back" onMouseDown={onClose}>
      <div className="om-modal om-settings" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Routines</h2>
        {list.map((r) => (
          <div key={r.id} className="om-role-row">
            <strong>{r.name}</strong>
            <span className="om-muted">
              every {r.intervalSeconds}s → {r.targetTerminalId.slice(0, 8)} · {r.isActive ? "● active" : "○ paused"}
            </span>
            <button onClick={() => invoke("routine_set_active", { id: r.id, active: !r.isActive }).catch((e) => setMsg(String(e))).finally(refresh)}>
              {r.isActive ? "Pause" : "Resume"}
            </button>
            <button onClick={() => invoke("routine_delete", { id: r.id }).catch((e) => setMsg(String(e))).finally(refresh)}>
              Delete
            </button>
          </div>
        ))}
        {list.length === 0 && <div className="om-muted">No routines. Chain prompts with && — min interval 60s.</div>}
        <div className="om-tab-body">
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Routine name" />
          <input value={prompt} onChange={(e) => setPrompt(e.currentTarget.value)} placeholder="prompt1 && prompt2" />
          <div className="om-role-new">
            <input type="number" min={60} value={secs} onChange={(e) => setSecs(parseInt(e.currentTarget.value, 10) || 300)} placeholder="secs" />
            <select value={target} onChange={(e) => setTarget(e.currentTarget.value)}>
              <option value="">target terminal…</option>
              {terminals.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              disabled={!name.trim() || !prompt.trim() || !target}
              onClick={() =>
                invoke("routine_create", { name: name.trim(), prompt, intervalSeconds: secs, targetTerminalId: target })
                  .then(() => {
                    setName("");
                    setPrompt("");
                  })
                  .catch((e) => setMsg(String(e)))
                  .finally(refresh)
              }
            >
              Create
            </button>
          </div>
        </div>
        {msg && <div className="om-muted">{msg}</div>}
        <div className="om-modal-row">
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

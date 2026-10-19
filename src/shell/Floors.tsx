import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Floor {
  id: string;
  name: string;
  branchName: string;
  worktreePath: string;
  createdAt: string;
}

export default function Floors({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [floors, setFloors] = useState<Floor[]>([]);
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setFloors(await invoke<Floor[]>("floor_list", { workspaceId }));
    } catch (e) {
      setMsg(String(e));
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  return (
    <div className="om-modal-back" onMouseDown={onClose}>
      <div className="om-modal om-settings" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Floors (git worktree)</h2>
        {floors.map((f) => (
          <div key={f.id} className="om-role-row">
            <strong>{f.name}</strong>
            <span className="om-muted">
              {f.branchName} · {f.worktreePath}
            </span>
            <button onClick={() => invoke("floor_land", { workspaceId, floorId: f.id }).then((m) => setMsg(String(m))).catch((e) => setMsg(String(e))).finally(refresh)}>
              Land
            </button>
            <button onClick={() => invoke("floor_remove", { workspaceId, floorId: f.id }).catch((e) => setMsg(String(e))).finally(refresh)}>
              Remove
            </button>
          </div>
        ))}
        {floors.length === 0 && <div className="om-muted">No floors. Create one below (requires a git repo).</div>}
        <div className="om-role-new">
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Floor name" />
          <input value={branch} onChange={(e) => setBranch(e.currentTarget.value)} placeholder="branch" />
          <button
            disabled={!name.trim() || !branch.trim()}
            onClick={() =>
              invoke("floor_create", { workspaceId, name: name.trim(), branch: branch.trim() })
                .then(() => {
                  setName("");
                  setBranch("");
                })
                .catch((e) => setMsg(String(e)))
                .finally(refresh)
            }
          >
            Create
          </button>
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

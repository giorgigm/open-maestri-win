import { useState } from "react";
import type { WorkspaceEntry } from "../lib/manifest";

export default function WorkspaceModal({
  initial,
  onCancel,
  onSave,
}: {
  initial?: WorkspaceEntry | null;
  onCancel: () => void;
  onSave: (name: string, dir: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "My Workspace");
  const [dir, setDir] = useState(initial?.workingDirectory ?? "C:\\");
  const valid = dir.trim().length > 0;
  return (
    <div className="om-modal-back" onMouseDown={onCancel}>
      <div className="om-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{initial ? "Edit Workspace" : "New Workspace"}</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} />
        </label>
        <label>
          Working directory (required)
          <input value={dir} onChange={(e) => setDir(e.currentTarget.value)} />
        </label>
        <div className="om-modal-row">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={!valid} onClick={() => onSave(name.trim() || "My Workspace", dir.trim())}>
            {initial ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { normalizeUrl } from "./PortalNode";

export default function NewPortalModal({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (url: string, name: string) => void;
}) {
  const [url, setUrl] = useState("http://localhost:3000");
  const [name, setName] = useState("");
  const valid = normalizeUrl(url) != null;
  return (
    <div className="om-modal-back" onMouseDown={onCancel}>
      <div className="om-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>New Portal</h2>
        <label>
          URL
          <input value={url} onChange={(e) => setUrl(e.currentTarget.value)} autoFocus placeholder="https://…" />
        </label>
        <label>
          Name (optional)
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Portal" />
        </label>
        <div className="om-modal-row">
          <button onClick={onCancel}>Cancel</button>
          <button
            className="primary"
            disabled={!valid}
            onClick={() => {
              const u = normalizeUrl(url)!;
              onCreate(u, name.trim() || "Portal");
            }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

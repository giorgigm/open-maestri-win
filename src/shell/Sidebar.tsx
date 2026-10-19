import { useMemo, useState } from "react";
import { orderWorkspaces, type SidebarLayout, type WorkspaceEntry } from "../lib/manifest";

interface SidebarProps {
  entries: WorkspaceEntry[];
  layout: SidebarLayout;
  activeId: string | null;
  nodeCountByWs: Map<string, number>;
  onSelect: (id: string) => void;
  onNew: () => void;
  onEdit: (e: WorkspaceEntry) => void;
  onDelete: (e: WorkspaceEntry) => void;
  onOpenSettings: () => void;
}

export default function Sidebar({
  entries,
  layout,
  activeId,
  nodeCountByWs,
  onSelect,
  onNew,
  onEdit,
  onDelete,
  onOpenSettings,
}: SidebarProps) {
  const [q, setQ] = useState("");
  const { ordered, grouped } = useMemo(() => orderWorkspaces(entries, layout), [entries, layout]);
  const needle = q.trim().toLowerCase();
  const visible = needle
    ? ordered.filter(
        (e) =>
          e.name.toLowerCase().includes(needle) ||
          e.workingDirectory.toLowerCase().includes(needle),
      )
    : ordered;

  return (
    <aside className="om-sidebar">
      <div className="om-side-top">
        <input
          className="om-search"
          placeholder="Search Workspaces"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <button className="om-icon-btn" title="New workspace" onClick={onNew}>
          +
        </button>
      </div>
      <div className="om-ws-list">
        {visible.map((e) => (
          <div
            key={e.id}
            className={`om-ws-item ${e.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(e.id)}
            onContextMenu={(ev) => {
              ev.preventDefault();
              onEdit(e);
            }}
            title={e.workingDirectory}
          >
            <span className="om-ws-icon">▤</span>
            <span className="om-ws-text">
              <span className="om-ws-name">{e.name}</span>
              <span className="om-ws-path">{e.workingDirectory}</span>
            </span>
            {(nodeCountByWs.get(e.id) ?? 0) > 0 && (
              <span className="om-ws-badge">{nodeCountByWs.get(e.id)}</span>
            )}
          </div>
        ))}
        {visible.length === 0 && <div className="om-ws-empty">No workspaces match.</div>}
        {[...grouped.entries()].map(
          ([gid, items]) =>
            items.length > 0 && (
              <div key={gid} className="om-ws-group">
                <div className="om-ws-group-name">{gid}</div>
                {items.map((e) => (
                  <div key={e.id} className="om-ws-item" onClick={() => onSelect(e.id)}>
                    <span className="om-ws-icon">▤</span>
                    <span className="om-ws-text">
                      <span className="om-ws-name">{e.name}</span>
                      <span className="om-ws-path">{e.workingDirectory}</span>
                    </span>
                  </div>
                ))}
              </div>
            ),
        )}
      </div>
      <div className="om-side-foot">
        <button className="om-link" onClick={() => activeId && onDelete(entries.find((e) => e.id === activeId)!)}>
          Delete workspace
        </button>
        <button className="om-gear" title="Settings" onClick={onOpenSettings}>
          ⚙
        </button>
      </div>
    </aside>
  );
}

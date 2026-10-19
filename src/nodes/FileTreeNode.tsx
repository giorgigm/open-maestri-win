import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileTreeContent } from "../lib/workspace-schema";

interface FileItem {
  name: string;
  path: string;
  is_dir: boolean;
  size: u64Alias;
}

type u64Alias = number;

const ICONS: Record<string, string> = {
  ts: "TS", tsx: "TS", js: "JS", jsx: "JS", rs: "RS", md: "MD", json: "{}", toml: "⚙",
  png: "🖼", jpg: "🖼", svg: "🖼", css: "🎨", html: "🌐",
};

function icon(name: string, isDir: boolean): string {
  if (isDir) return "📁";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ICONS[ext] ?? "📄";
}

/** File tree: toolbar (path + List|Grid + branch) + lazy list/grid + diff/commit. */
export default function FileTreeNode({
  content,
  onRootChange,
}: {
  content: FileTreeContent;
  onRootChange: (root: string) => void;
}) {
  const [root, setRoot] = useState(content.rootPath);
  const [draft, setDraft] = useState(content.rootPath);
  const [mode, setMode] = useState<"list" | "grid">(content.viewMode === "grid" ? "grid" : "list");
  const [items, setItems] = useState<FileItem[]>([]);
  const [expanded, setExpanded] = useState<Map<string, FileItem[]>>(new Map());
  const [status, setStatus] = useState<Map<string, string>>(new Map());
  const [branch, setBranch] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = async (r: string) => {
    setErr(null);
    try {
      setItems(await invoke<FileItem[]>("fs_list", { path: r }));
    } catch (e) {
      setErr(String(e));
      setItems([]);
    }
    try {
      const st = await invoke<Record<string, string>>("git_status", { root: r });
      setStatus(new Map(Object.entries(st)));
      setBranch(await invoke<string>("git_branch", { root: r }));
    } catch {
      setStatus(new Map());
      setBranch(null);
    }
    setExpanded(new Map());
    setDiff(null);
  };

  useEffect(() => {
    void load(root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  const toggle = async (it: FileItem) => {
    if (!it.is_dir) {
      // show file diff (relative path for git)
      const rel = it.path.startsWith(root) ? it.path.slice(root.length).replace(/^[/\\]/, "") : it.path;
      setDiffPath(rel);
      try {
        setDiff(await invoke<string>("git_diff", { root, path: rel }));
      } catch (e) {
        setDiff(String(e));
      }
      return;
    }
    if (expanded.has(it.path)) {
      const m = new Map(expanded);
      m.delete(it.path);
      setExpanded(m);
      return;
    }
    try {
      const kids = await invoke<FileItem[]>("fs_list", { path: it.path });
      setExpanded(new Map(expanded).set(it.path, kids));
    } catch (e) {
      setErr(String(e));
    }
  };

  const showStat = async () => {
    setDiffPath(null);
    try {
      setDiff(await invoke<string>("git_diff", { root }));
    } catch (e) {
      setDiff(String(e));
    }
  };

  const commit = async () => {
    try {
      await invoke<string>("git_commit", { root, message: msg });
      setMsg("");
      setDiff(null);
      const st = await invoke<Record<string, string>>("git_status", { root });
      setStatus(new Map(Object.entries(st)));
    } catch (e) {
      setErr(String(e));
    }
  };

  const renderRow = (it: FileItem, depth: number) => {
    const rel = it.path.startsWith(root) ? it.path.slice(root.length).replace(/^[/\\]/, "").replace(/\\/g, "/") : it.name;
    const badge = status.get(rel) ?? status.get(it.name);
    return (
      <div key={it.path}>
        <div className="ft-row" style={{ paddingLeft: 6 + depth * 14 }} onClick={() => void toggle(it)}>
          <span className="ft-caret">{it.is_dir ? (expanded.has(it.path) ? "▾" : "▸") : "·"}</span>
          <span className="ft-name">
            {icon(it.name, it.is_dir)} {it.name}
          </span>
          {badge && <span className={`ft-badge ft-${badge.replace(/[^A-Za-z]/g, "")}`}>{badge}</span>}
        </div>
        {expanded.get(it.path)?.map((k) => (
          <div key={k.path}>
            {renderRowFlat(k, depth + 1)}
          </div>
        ))}
      </div>
    );
  };

  const renderRowFlat = (it: FileItem, depth: number) => renderRow(it, depth);

  return (
    <div className="ft-node">
      <div className="ft-bar">
        <button title="Up" onClick={() => {
          const up = root.replace(/[/\\][^/\\]+$/, "");
          if (up && up !== root) {
            setRoot(up);
            setDraft(up);
            onRootChange(up);
          }
        }}>‹</button>
        <input value={draft} onChange={(e) => setDraft(e.currentTarget.value)} onKeyDown={(e) => {
          if (e.key === "Enter") {
            setRoot(draft);
            onRootChange(draft);
          }
        }} spellCheck={false} />
        <button className={mode === "list" ? "on" : ""} onClick={() => setMode("list")}>List</button>
        <button className={mode === "grid" ? "on" : ""} onClick={() => setMode("grid")}>Grid</button>
        <button className="ft-branch" title={branch ? `Branch ${branch} — diff stat` : "Not a git repo"} onClick={() => void showStat()}>
          {branch ? `⑂ ${branch || "(detached)"}` : "no repo"}
        </button>
      </div>
      <div className="ft-main">
        <div className="ft-list">
          {err && <div className="ft-err">{err}</div>}
          {mode === "list" ? (
            items.map((it) => renderRow(it, 0))
          ) : (
            <div className="ft-grid">
              {items.map((it) => (
                <div key={it.path} className="ft-cell" onClick={() => void toggle(it)} title={it.path}>
                  <span className="ft-cell-icon">{icon(it.name, it.is_dir)}</span>
                  <span className="ft-cell-name">{it.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {diff !== null && (
          <div className="ft-diff">
            <div className="ft-diff-head">
              {diffPath ?? "changes"}
              <button onClick={() => setDiff(null)}>×</button>
            </div>
            <pre>{diff || "(no changes)"}</pre>
            <div className="ft-commit">
              <input value={msg} onChange={(e) => setMsg(e.currentTarget.value)} placeholder="Commit message…" />
              <button disabled={!msg.trim()} onClick={() => void commit()}>Commit</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

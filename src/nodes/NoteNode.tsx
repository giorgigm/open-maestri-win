import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CanvasNode, StickyNoteContent } from "../lib/workspace-schema";
import { renderMarkdown } from "../lib/markdown";

export default function NoteNode({
  node,
  content,
  workspaceId,
  onContentChange,
  onTogglePreview,
  onRename,
}: {
  node: CanvasNode;
  content: StickyNoteContent;
  workspaceId: string;
  onContentChange: (text: string) => void;
  onTogglePreview: () => void;
  onRename: (name: string) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(displayName());
  const timer = useRef(0);

  function displayName(): string {
    if (content.hasCustomName && content.fileName) return content.fileName.replace(/\.md$/, "");
    const first = (text ?? "").split("\n")[0]?.trim();
    return first ? first.slice(0, 40) : (content.fileName ?? "Note").replace(/\.md$/, "");
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const t = await invoke<string>("note_load", {
          workspaceId,
          fileName: content.fileName ?? "Note.md",
        });
        if (alive) {
          setText(t);
          if (!content.hasCustomName) setName(t.split("\n")[0]?.trim().slice(0, 40) || "Note");
        }
      } catch {
        if (alive) setText("");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.fileName]);

  // flush on unmount (never lose content)
  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const edit = (v: string) => {
    setText(v);
    onContentChange(v);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      invoke("note_save", { workspaceId, fileName: content.fileName ?? "Note.md", text: v }).catch(() => {});
    }, 500);
  };

  if (text === null) return <div className="note-loading">loading…</div>;

  return (
    <div className="note-node" style={{ background: content.color }}>
      <div className="note-head">
        <button
          className={content.isPreviewing ? "" : "on"}
          onClick={() => content.isPreviewing && onTogglePreview()}
          title="Raw markdown"
        >
          Raw
        </button>
        <button
          className={content.isPreviewing ? "on" : ""}
          onClick={() => !content.isPreviewing && onTogglePreview()}
          title="Formatted preview"
        >
          Formatted
        </button>
        {editingName ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onBlur={() => {
              setEditingName(false);
              onRename(name);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        ) : (
          <span className="note-name" onDoubleClick={() => setEditingName(true)} title="Double-click to rename">
            {displayName()}
          </span>
        )}
      </div>
      {content.isPreviewing ? (
        <div className="note-formatted" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
      ) : (
        <textarea
          className="note-raw"
          value={text}
          onChange={(e) => edit(e.currentTarget.value)}
          placeholder="Start typing your note…"
        />
      )}
      <span style={{ display: "none" }}>{node.id}</span>
    </div>
  );
}

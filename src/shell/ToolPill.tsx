import type { ToolId } from "../lib/manifest";

const TOOLS: { id: ToolId; label: string; hint: string; icon: string }[] = [
  { id: "select", label: "Select", hint: "Esc", icon: "➤" },
  { id: "terminal", label: "Terminal", hint: "click canvas", icon: "▣" },
  { id: "note", label: "Note", hint: "click canvas", icon: "✎" },
  { id: "text", label: "Text", hint: "click canvas", icon: "Aa" },
  { id: "drawing", label: "Drawing", hint: "soon", icon: "✒" },
  { id: "file", label: "File Tree", hint: "click canvas", icon: "▤" },
  { id: "portal", label: "Portal", hint: "P", icon: "◉" },
  { id: "connection", label: "Connection", hint: "L", icon: "⌁" },
];

export default function ToolPill({
  active,
  onPick,
}: {
  active: ToolId;
  onPick: (t: ToolId) => void;
}) {
  return (
    <div className="om-pill" role="toolbar" aria-label="Canvas tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={t.id === active ? "on" : ""}
          title={`${t.label} (${t.hint})`}
          onClick={() => onPick(t.id)}
        >
          {t.icon}
        </button>
      ))}
    </div>
  );
}

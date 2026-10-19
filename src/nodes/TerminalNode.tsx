import type { TerminalContent } from "../lib/workspace-schema";

/** Terminal node chrome: header (icon/color/name + badges) + body status + footer cwd. */
export default function TerminalNode({
  content,
  badge,
  roleName,
  attention,
}: {
  content: TerminalContent;
  badge?: number | null;
  roleName?: string | null;
  attention?: boolean;
}) {
  return (
    <div className="term-node">
      <div className="term-head" style={{ borderLeftColor: content.color }}>
        <span className="term-icon" style={{ background: content.color }}>
          {content.name[0]?.toUpperCase() ?? "›"}
        </span>
        <span className="term-name">{content.name}</span>
        {roleName && <span className="term-role">{roleName}</span>}
        {content.isManager && <span className="term-maestro">Maestro</span>}
        {badge != null && <span className="term-badge">⌃{badge}</span>}
        {attention && <span className="term-dot" title="Needs attention" />}
      </div>
      <div className="term-body">
        <div className="term-cmd">{content.command || "powershell.exe"}</div>
        <div className="term-hint">PTY real chega em pty-backend — ask/check via omaestri quando conectar.</div>
      </div>
      <div className="term-foot">
        <span className="term-cwd" title={content.workingDirectory}>
          {content.workingDirectory}
        </span>
        <span className={`term-status term-${content.status}`}>{content.status}</span>
      </div>
    </div>
  );
}

import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { TerminalContent } from "../lib/workspace-schema";

/** Terminal node chrome: header + live xterm (ConPTY) + footer cwd. */
export default function TerminalNode({
  content,
  badge,
  roleName,
  attention,
  workspaceId,
}: {
  content: TerminalContent;
  badge?: number | null;
  roleName?: string | null;
  attention?: boolean;
  workspaceId: string;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const term = new Terminal({ fontSize: content.fontSize ?? 13, theme: { background: "#0c0c0e" } });
    const fit = new FitAddon();
    term.loadAddon(fit);
    termRef.current = term;

    let alive = true;
    let opened = false;
    const unlisteners: (() => void)[] = [];

    const tryOpen = () => {
      if (!alive || opened) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) {
        requestAnimationFrame(tryOpen);
        return;
      }
      opened = true;
      try {
        term.open(el);
        try {
          fit.fit();
        } catch {
          /* keep default 80x24 */
        }
      } catch (err) {
        term.write(`\r\n[terminal render failed: ${String(err)}]\r\n`);
        return;
      }
      boot();
    };

    const boot = () => {
      (async () => {
        unlisteners.push(await listen<string>(`pty-output:${content.id}`, (e) => term.write(e.payload)));
        unlisteners.push(
          await listen<number>(`pty-exit:${content.id}`, (e) => term.write(`\r\n[exit ${e.payload}]\r\n`)),
        );
        if (alive) {
          try {
            await invoke("pty_spawn", {
              terminalId: content.id,
              command: content.command,
              cwd: content.workingDirectory,
              cols: Math.max(1, term.cols || 80),
              rows: Math.max(1, term.rows || 24),
              workspaceId,
              agentName: content.name,
            });
          } catch (err) {
            term.write(`\r\n[pty spawn failed: ${String(err)}]\r\n`);
          }
        }
      })();
    };
    const onData = term.onData((data) => {
      invoke("pty_write", { terminalId: content.id, data }).catch(() => {});
    });

    const onResize = () => {
      if (!opened) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      invoke("pty_resize", { terminalId: content.id, cols: term.cols, rows: term.rows }).catch(() => {});
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    requestAnimationFrame(tryOpen);

    return () => {
      alive = false;
      onData.dispose();
      ro.disconnect();
      unlisteners.forEach((u) => u());
      invoke("pty_kill", { terminalId: content.id }).catch(() => {});
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.id]);

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
      <div className="term-xterm" ref={divRef} />
      <div className="term-foot">
        <span className="term-cwd" title={content.workingDirectory}>
          {content.workingDirectory}
        </span>
        <span className={`term-status term-${content.status}`}>{content.status}</span>
      </div>
    </div>
  );
}

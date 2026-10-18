import { useEffect, useRef, useState } from "react";
import {
  frameArrayToRect,
  nodeDisplayName,
  nodeVariant,
  type CanvasNode,
  type FrameRect,
  type WorkspaceDocument,
} from "../lib/workspace-schema";
import { canvasToScreen, zoomAround, type Viewport } from "../lib/viewport";
import { createRope, tickRope, ropeToPath } from "../lib/rope";
import type { ToolId } from "../lib/manifest";

interface RopeState {
  id: string;
  d: string;
  status: "idle" | "communicating";
}

function nodeCenter(r: FrameRect) {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export interface CanvasViewProps {
  doc: WorkspaceDocument;
  viewport: Viewport;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
  updateNodeFrame: (id: string, r: FrameRect) => void;
  tool: ToolId;
  setTool: (t: ToolId) => void;
  onAddNode: (kind: "terminal" | "stickyNote" | "text" | "fileTree" | "portal") => void;
  onNodeContextMenu: (e: React.MouseEvent, nodeId: string) => void;
  onCanvasContextMenu: (e: React.MouseEvent) => void;
}

/**
 * Infinite canvas: pan/zoom, nodes, rope connections, minimap.
 * Extracted verbatim from the F3 App; AppShell owns workspace + tool state.
 */
export default function CanvasView({
  doc,
  viewport,
  setViewport,
  updateNodeFrame,
  tool,
  onAddNode,
  onNodeContextMenu,
  onCanvasContextMenu,
}: CanvasViewProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ropes, setRopes] = useState<RopeState[]>([]);
  const docRef = useRef(doc);
  const viewRef = useRef(viewport);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const spaceRef = useRef(false);

  docRef.current = doc;
  viewRef.current = viewport;

  // expose selection for shell shortcuts
  useEffect(() => {
    (window as unknown as { __omSelection?: Set<string> }).__omSelection = selected;
  }, [selected]);

  // ---- rope physics loop (60Hz) ---------------------------------------------
  useEffect(() => {
    const conns: { id: string; a: string; b: string }[] = [
      ...doc.payload.connections.map((c) => ({ id: c.id, a: c.terminalIdA, b: c.terminalIdB })),
      ...doc.payload.noteConnections.map((c) => ({ id: c.id, a: c.terminalId, b: c.noteNodeId })),
      ...doc.payload.portalConnections.map((c) => ({ id: c.id, a: c.terminalId, b: c.portalNodeId })),
    ];
    const byId = new Map(doc.payload.nodes.map((n) => [n.id, n]));
    const termByContent = new Map<string, CanvasNode>();
    for (const n of doc.payload.nodes) {
      if (nodeVariant(n.content) === "terminal") {
        const inner = (n.content as { terminal: { _0: { id: string } } }).terminal._0;
        termByContent.set(inner.id, n);
      }
    }
    const resolved = conns.flatMap((c: { id: string; a: string; b: string }) => {
      const na = byId.get(c.a) ?? termByContent.get(c.a);
      const nb = byId.get(c.b) ?? termByContent.get(c.b);
      if (!na || !nb) return [];
      const ca = nodeCenter(frameArrayToRect(na.frame));
      const cb = nodeCenter(frameArrayToRect(nb.frame));
      return [{ id: c.id, rope: createRope(ca.x, ca.y, cb.x, cb.y), na, nb }];
    });
    let raf = 0;
    let lastOut = "";
    const step = () => {
      const v = viewRef.current;
      const d = docRef.current;
      if (d) {
        const byIdLive = new Map(d.payload.nodes.map((n: CanvasNode) => [n.id, n]));
        const out: RopeState[] = [];
        for (const r of resolved) {
          const na = byIdLive.get(r.na.id);
          const nb = byIdLive.get(r.nb.id);
          if (!na || !nb) continue;
          const ca = nodeCenter(frameArrayToRect(na.frame));
          const cb = nodeCenter(frameArrayToRect(nb.frame));
          tickRope(r.rope, ca.x, ca.y, cb.x, cb.y);
          const pts = r.rope.points.map((p: { x: number; y: number }) => canvasToScreen(p.x, p.y, v));
          out.push({ id: r.id, d: ropeToPath(pts), status: "idle" });
        }
        const key = out.map((o: RopeState) => o.id + o.d).join("|");
        if (key !== lastOut) {
          lastOut = key;
          setRopes(out);
        }
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.payload.nodes.length, doc?.payload.connections.length]);

  // ---- canvas pan/zoom --------------------------------------------------------
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      setViewport((v) =>
        zoomAround(v, e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.1 : 1 / 1.1),
      );
    } else {
      setViewport((v) => ({
        ...v,
        originX: v.originX + e.deltaX / v.zoom,
        originY: v.originY + e.deltaY / v.zoom,
      }));
    }
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || spaceRef.current || e.target === e.currentTarget) {
      dragRef.current = { sx: e.clientX, sy: e.clientY, ox: viewport.originX, oy: viewport.originY };
    }
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const dr = dragRef.current;
    if (dr) {
      setViewport((v) => ({
        ...v,
        originX: dr.ox - (e.clientX - dr.sx) / v.zoom,
        originY: dr.oy - (e.clientY - dr.sy) / v.zoom,
      }));
    }
  };
  const onMouseUp = () => {
    dragRef.current = null;
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // click-to-place when a creation tool is active (mirrors Mac drag-to-place,
  // simplified: click places default-size node; F-canvas-core adds drag rect)
  const onCanvasClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    setSelected(new Set());
    if (tool === "terminal" || tool === "note" || tool === "text") {
      onAddNode(tool === "note" ? "stickyNote" : tool);
    } else if (tool === "file" || tool === "portal") {
      onAddNode(tool === "file" ? "fileTree" : "portal");
    }
  };

  return (
    <div
      className={`canvas-root ${tool === "connection" ? "connect-mode" : ""}`}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onClick={onCanvasClick}
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          onCanvasContextMenu(e);
        }
      }}
    >
      <svg className="rope-layer">
        {ropes.map((r) => (
          <path key={r.id} d={r.d} className="rope" />
        ))}
      </svg>
      {doc.payload.nodes.map((n) => {
        const r = frameArrayToRect(n.frame);
        const s = canvasToScreen(r.x, r.y, viewport);
        const variant = nodeVariant(n.content);
        return (
          <div
            key={n.id}
            className={`node node-${variant} ${selected.has(n.id) ? "selected" : ""}`}
            style={{
              left: s.x,
              top: s.y,
              width: r.w * viewport.zoom,
              height: r.h * viewport.zoom,
            }}
            onMouseDown={(e) => {
              if (e.button === 2) return;
              e.stopPropagation();
              setSelected(new Set([n.id]));
              const start = frameArrayToRect(n.frame);
              const move = (me: MouseEvent) => {
                const v = viewRef.current;
                if (me.ctrlKey || me.metaKey) return; // duplicate handled in S6
                updateNodeFrame(n.id, {
                  ...start,
                  x: start.x + (me.clientX - e.clientX) / v.zoom,
                  y: start.y + (me.clientY - e.clientY) / v.zoom,
                });
              };
              const up = () => {
                window.removeEventListener("mousemove", move);
                window.removeEventListener("mouseup", up);
              };
              window.addEventListener("mousemove", move);
              window.addEventListener("mouseup", up);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSelected(new Set([n.id]));
              onNodeContextMenu(e, n.id);
            }}
          >
            <div className="node-header">{nodeDisplayName(n.id, n.content)}</div>
            <div className="node-body">
              {variant === "terminal" && <div className="term-placeholder">powershell.exe — PTY em F4</div>}
              {variant === "stickyNote" && <div className="note-placeholder">note…</div>}
              {variant === "text" && (
                <span>{(n.content as { text: { _0: { text: string } } }).text._0.text}</span>
              )}
              {(variant === "fileTree" || variant === "portal") && (
                <div className="note-placeholder">{variant === "fileTree" ? "file tree…" : "portal…"}</div>
              )}
            </div>
          </div>
        );
      })}
      <div className="minimap-slot">
        <Minimap doc={doc} viewport={viewport} onJump={(x, y) => setViewport((v) => ({ ...v, originX: x, originY: y }))} />
      </div>
    </div>
  );
}

export function Minimap({
  doc,
  viewport,
  onJump,
}: {
  doc: WorkspaceDocument;
  viewport: Viewport;
  onJump: (x: number, y: number) => void;
}) {
  const W = 160;
  const H = 110;
  const all = doc.payload.nodes.map((n) => frameArrayToRect(n.frame));
  const minX = Math.min(viewport.originX, ...all.map((r) => r.x));
  const minY = Math.min(viewport.originY, ...all.map((r) => r.y));
  const maxX = Math.max(viewport.originX + W / viewport.zoom, ...all.map((r) => r.x + r.w));
  const maxY = Math.max(viewport.originY + H / viewport.zoom, ...all.map((r) => r.y + r.h));
  const sx = W / Math.max(1, maxX - minX);
  const sy = H / Math.max(1, maxY - minY);
  const s = Math.min(sx, sy);
  return (
    <svg
      width={W}
      height={H}
      onMouseDown={(e) => {
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        onJump(minX + (e.clientX - rect.left) / s - W / viewport.zoom / 2, minY + (e.clientY - rect.top) / s - H / viewport.zoom / 2);
      }}
    >
      <rect x={0} y={0} width={W} height={H} className="mm-bg" />
      {all.map((r, i) => (
        <rect
          key={i}
          x={(r.x - minX) * s}
          y={(r.y - minY) * s}
          width={Math.max(2, r.w * s)}
          height={Math.max(2, r.h * s)}
          className="mm-node"
        />
      ))}
      <rect
        x={(viewport.originX - minX) * s}
        y={(viewport.originY - minY) * s}
        width={W * s / viewport.zoom}
        height={H * s / viewport.zoom}
        className="mm-view"
      />
    </svg>
  );
}

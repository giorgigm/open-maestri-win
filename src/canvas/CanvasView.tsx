import { useEffect, useRef, useState } from "react";
import {
  frameArrayToRect,
  nodeDisplayName,
  nodeVariant,
  type CanvasNode,
  type FrameRect,
  type StickyNoteContent,
  type TerminalContent,
  type WorkspaceDocument,
} from "../lib/workspace-schema";
import { canvasToScreen, screenToCanvas, zoomAround, type Viewport } from "../lib/viewport";
import { createRope, tickRope, ropeToPath } from "../lib/rope";
import { snapRect, type Guide } from "./snap";
import TerminalNode from "../nodes/TerminalNode";
import NoteNode from "../nodes/NoteNode";
import { BUILTIN_ROLES } from "../lib/presets";
import type { ToolId } from "../lib/manifest";

export type AddKind = "terminal" | "stickyNote" | "text" | "fileTree" | "portal";

interface RopeState {
  id: string;
  d: string;
  status: "idle" | "communicating";
}

function nodeCenter(r: FrameRect) {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function roleNameFor(roleId?: string | null): string | null {
  if (!roleId) return null;
  return BUILTIN_ROLES.find((r) => r.id === roleId)?.name ?? null;
}

function minSize(variant: string): { w: number; h: number } {
  if (variant === "terminal") return { w: 200, h: 100 };
  if (variant === "stickyNote") return { w: 120, h: 80 };
  return { w: 60, h: 40 };
}

type HandleDir = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: HandleDir[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function applyHandle(start: FrameRect, dir: HandleDir, dx: number, dy: number, min: { w: number; h: number }): FrameRect {
  let { x, y, w, h } = start;
  if (dir.includes("e")) w = Math.max(min.w, start.w + dx);
  if (dir.includes("s")) h = Math.max(min.h, start.h + dy);
  if (dir.includes("w")) {
    const nw = Math.max(min.w, start.w - dx);
    x = start.x + (start.w - nw);
    w = nw;
  }
  if (dir.includes("n")) {
    const nh = Math.max(min.h, start.h - dy);
    y = start.y + (start.h - nh);
    h = nh;
  }
  return { x, y, w, h };
}

export interface CanvasViewProps {
  doc: WorkspaceDocument;
  viewport: Viewport;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
  updateNodeFrame: (id: string, r: FrameRect) => void;
  tool: ToolId;
  setTool: (t: ToolId) => void;
  terminalBadges: Map<string, number>;
  onAddNode: (kind: AddKind) => void;
  onAddNodeAt: (kind: AddKind, rect: FrameRect) => void;
  onDuplicateNode: (id: string) => { newId: string; rect: FrameRect } | null;
  onDeleteConnection: (connId: string) => void;
  onToggleNotePreview: (id: string) => void;
  onRenameNote: (id: string, name: string) => void;
  onNodeContextMenu: (e: React.MouseEvent, nodeId: string) => void;
  onCanvasContextMenu: (e: React.MouseEvent) => void;
  onRopeContextMenu: (e: React.MouseEvent, connId: string) => void;
  onConnectNodes: (fromId: string, toId: string) => string | null;
  connectSource: string | null;
  setConnectSource: (id: string | null) => void;
}

export default function CanvasView({
  doc,
  viewport,
  setViewport,
  updateNodeFrame,
  tool,
  setTool,
  terminalBadges,
  onAddNodeAt,
  onDuplicateNode,
  onToggleNotePreview,
  onRenameNote,
  onNodeContextMenu,
  onCanvasContextMenu,
  onRopeContextMenu,
  onConnectNodes,
  connectSource,
  setConnectSource,
}: CanvasViewProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ropes, setRopes] = useState<RopeState[]>([]);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [rubber, setRubber] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const docRef = useRef(doc);
  const viewRef = useRef(viewport);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const placeRef = useRef<{ sx: number; sy: number } | null>(null);
  const spaceRef = useRef(false);

  docRef.current = doc;
  viewRef.current = viewport;

  useEffect(() => {
    (window as unknown as { __omSelection?: Set<string> }).__omSelection = selected;
  }, [selected]);

  const isCreateTool = tool === "terminal" || tool === "note" || tool === "text" || tool === "file" || tool === "portal";
  const toolKind = (): AddKind | null => {
    if (tool === "terminal" || tool === "text") return tool;
    if (tool === "note") return "stickyNote";
    if (tool === "file") return "fileTree";
    if (tool === "portal") return "portal";
    return null;
  };

  // ---- rope physics loop (60Hz) ---------------------------------------------
  useEffect(() => {
    const conns: { id: string; a: string; b: string }[] = [
      ...doc.payload.connections.map((c) => ({ id: c.id, a: c.terminalIdA, b: c.terminalIdB })),
      ...doc.payload.noteConnections.map((c) => ({ id: c.id, a: c.terminalId, b: c.noteNodeId })),
      ...doc.payload.portalConnections.map((c) => ({ id: c.id, a: c.terminalId, b: c.portalNodeId })),
      ...doc.payload.noteToNoteConnections.map((c) => ({ id: c.id, a: c.noteNodeIdA, b: c.noteNodeIdB })),
      ...doc.payload.portalToPortalConnections.map((c) => ({ id: c.id, a: c.portalIdA, b: c.portalIdB })),
    ];
    const byId = new Map(doc.payload.nodes.map((n) => [n.id, n]));
    const termByContent = new Map<string, CanvasNode>();
    for (const n of doc.payload.nodes) {
      if (nodeVariant(n.content) === "terminal") {
        termByContent.set((n.content as { terminal: { _0: { id: string } } }).terminal._0.id, n);
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
        const live = new Map(d.payload.nodes.map((n: CanvasNode) => [n.id, n]));
        const out: RopeState[] = [];
        for (const r of resolved) {
          const na = live.get(r.na.id);
          const nb = live.get(r.nb.id);
          if (!na || !nb) continue;
          const ca = nodeCenter(frameArrayToRect(na.frame));
          const cb = nodeCenter(frameArrayToRect(nb.frame));
          tickRope(r.rope, ca.x, ca.y, cb.x, cb.y);
          const pts = r.rope.points.map((p: { x: number; y: number }) => canvasToScreen(p.x, p.y, v));
          out.push({ id: r.id, d: ropeToPath(pts), status: endpointActive(na, nb) ? "communicating" : "idle" });
        }
        const key = out.map((o: RopeState) => o.id + o.d + o.status).join("|");
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

  function endpointActive(na: CanvasNode, nb: CanvasNode): boolean {
    for (const n of [na, nb]) {
      const v = nodeVariant(n.content);
      if (v === "terminal" && (n.content as { terminal: { _0: { status: string } } }).terminal._0.status === "running") return true;
      if (v === "portal" && (n.content as { portal: { _0: { status: string } } }).portal._0.status === "loading") return true;
    }
    return false;
  }

  // ---- pan / rubber-band place --------------------------------------------------
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
    if (e.button === 1 || spaceRef.current) {
      dragRef.current = { sx: e.clientX, sy: e.clientY, ox: viewport.originX, oy: viewport.originY };
      return;
    }
    if (e.button === 0 && e.target === e.currentTarget) {
      if (isCreateTool) {
        placeRef.current = { sx: e.clientX, sy: e.clientY };
        setRubber({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
      } else {
        dragRef.current = { sx: e.clientX, sy: e.clientY, ox: viewport.originX, oy: viewport.originY };
      }
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
      return;
    }
    if (placeRef.current) {
      const p = placeRef.current;
      setRubber({ x0: p.sx, y0: p.sy, x1: e.clientX, y1: e.clientY });
      return;
    }
    if (connectSource) {
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      setGhost({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  };

  const onMouseUp = (e: React.MouseEvent) => {
    dragRef.current = null;
    const p = placeRef.current;
    placeRef.current = null;
    if (p && rubber) {
      const kind = toolKind();
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const a = screenToCanvas(p.sx - rect.left, p.sy - rect.top, viewRef.current);
      const b = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top, viewRef.current);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      setRubber(null);
      if (kind) {
        if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 4) {
          // click: default size centered at click
          const dw = kind === "text" ? 260 : 420;
          const dh = kind === "text" ? 80 : 300;
          onAddNodeAt(kind, { x: a.x - dw / 2, y: a.y - dh / 2, w: dw, h: dh });
        } else {
          onAddNodeAt(kind, { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w, h });
        }
      }
      setSelected(new Set());
    } else {
      setRubber(null);
    }
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = false;
      if (e.key === "Escape") {
        setSelected(new Set());
        setConnectSource(null);
        setGhost(null);
        setTool("select");
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- node drag (multi + Ctrl-duplicate + Alt-snap) ------------------------------
  const startNodeDrag = (e: React.MouseEvent, nodeId: string) => {
    const d = docRef.current;
    // Ctrl+drag duplicates first
    let targetId = nodeId;
    let base = new Set(selected.has(nodeId) ? selected : [nodeId]);
    if (e.shiftKey) {
      const next = new Set(selected);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      setSelected(next);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const dup = onDuplicateNode(nodeId);
      if (dup) {
        targetId = dup.newId;
        base = new Set([dup.newId]);
        setSelected(base);
      }
    } else if (!selected.has(nodeId)) {
      base = new Set([nodeId]);
      setSelected(base);
    }
    void targetId;
    const starts = new Map<string, FrameRect>();
    for (const id of base) {
      const n = d.payload.nodes.find((x) => x.id === id);
      if (n && !n.isLocked) starts.set(id, frameArrayToRect(n.frame));
    }
    if (starts.size === 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (me: MouseEvent) => {
      const vv = viewRef.current;
      const dx0 = (me.clientX - sx) / vv.zoom;
      const dy0 = (me.clientY - sy) / vv.zoom;
      if (me.altKey && starts.size === 1) {
        // magnetic snap single node
        const [id, st] = [...starts.entries()][0];
        const cand = { ...st, x: st.x + dx0, y: st.y + dy0 };
        const others = docRef.current.payload.nodes
          .filter((x) => x.id !== id)
          .map((x) => frameArrayToRect(x.frame));
        const snap = snapRect(cand, others, 6 / vv.zoom);
        updateNodeFrame(id, { ...cand, x: cand.x + snap.dx, y: cand.y + snap.dy });
        setGuides(snap.guides);
      } else {
        setGuides([]);
        for (const [id, st] of starts) {
          updateNodeFrame(id, { ...st, x: st.x + dx0, y: st.y + dy0 });
        }
      }
    };
    const up = () => {
      setGuides([]);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const startResize = (e: React.MouseEvent, nodeId: string, dir: HandleDir) => {
    e.stopPropagation();
    const n = docRef.current.payload.nodes.find((x) => x.id === nodeId);
    if (!n) return;
    const start = frameArrayToRect(n.frame);
    const min = minSize(nodeVariant(n.content));
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (me: MouseEvent) => {
      const vv = viewRef.current;
      updateNodeFrame(nodeId, applyHandle(start, dir, (me.clientX - sx) / vv.zoom, (me.clientY - sy) / vv.zoom, min));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      className={`canvas-root ${tool === "connection" || connectSource ? "connect-mode" : ""}`}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onClick={(e) => {
        // click empty canvas cancels connect mode (mirrors Mac)
        if (e.target === e.currentTarget && connectSource) {
          setConnectSource(null);
          setGhost(null);
          setTool("select");
        }
      }}
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          onCanvasContextMenu(e);
        }
      }}
    >
      <svg className="rope-layer">
        {ropes.map((r) => (
          <g key={r.id}>
            <path
              d={r.d}
              className="rope-hit"
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRopeContextMenu(e, r.id);
              }}
            />
            <path d={r.d} className={`rope rope-${r.status}`} />
          </g>
        ))}
        {ghost && connectSource && (() => {
          const src = docRef.current.payload.nodes.find((x) => x.id === connectSource);
          if (!src) return null;
          const c = nodeCenter(frameArrayToRect(src.frame));
          const s = canvasToScreen(c.x, c.y, viewRef.current);
          return <line x1={s.x} y1={s.y} x2={ghost.x} y2={ghost.y} className="om-ghost" />;
        })()}
        {guides.map((g, i) => {
          const v = viewRef.current;
          const a = canvasToScreen(g.orientation === "v" ? g.pos : g.from, g.orientation === "v" ? g.from : g.pos, v);
          const b = canvasToScreen(g.orientation === "v" ? g.pos : g.to, g.orientation === "v" ? g.to : g.pos, v);
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="om-guide" />;
        })}
      </svg>
      {rubber && (
        <div
          className="om-rubber"
          style={{
            left: Math.min(rubber.x0, rubber.x1),
            top: Math.min(rubber.y0, rubber.y1),
            width: Math.abs(rubber.x1 - rubber.x0),
            height: Math.abs(rubber.y1 - rubber.y0),
          }}
        />
      )}
      {doc.payload.nodes.map((n) => {
        const r = frameArrayToRect(n.frame);
        const s = canvasToScreen(r.x, r.y, viewport);
        const variant = nodeVariant(n.content);
        const sel = selected.has(n.id);
        return (
          <div
            key={n.id}
            className={`node node-${variant} ${sel ? "selected" : ""}`}
            style={{
              left: s.x,
              top: s.y,
              width: r.w * viewport.zoom,
              height: r.h * viewport.zoom,
            }}
            onMouseDown={(e) => {
              if (e.button === 2) return;
              e.stopPropagation();
              // connect mode: click completes the pair
              if (connectSource) {
                if (connectSource !== n.id) {
                  onConnectNodes(connectSource, n.id);
                }
                setConnectSource(null);
                setGhost(null);
                setTool("select");
                return;
              }
              if (tool === "connection") {
                setConnectSource(n.id);
                setSelected(new Set([n.id]));
                return;
              }
              startNodeDrag(e, n.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSelected(new Set([n.id]));
              onNodeContextMenu(e, n.id);
            }}
          >
            {variant === "terminal" ? (
              <TerminalNode
                content={(n.content as { terminal: { _0: TerminalContent } }).terminal._0}
                badge={terminalBadges.get(n.id) ?? null}
                roleName={roleNameFor((n.content as { terminal: { _0: TerminalContent } }).terminal._0.assignedRoleId)}
                workspaceId={doc.payload.id}
              />
            ) : variant === "stickyNote" ? (
              <NoteNode
                node={n}
                content={(n.content as { stickyNote: { _0: StickyNoteContent } }).stickyNote._0}
                workspaceId={doc.payload.id}
                onContentChange={() => {}}
                onTogglePreview={() => onToggleNotePreview(n.id)}
                onRename={(name) => onRenameNote(n.id, name)}
              />
            ) : (
              <>
                <div className="node-header">{nodeDisplayName(n.id, n.content)}</div>
                <div className="node-body">
                  {variant === "text" && (
                    <span>{(n.content as { text: { _0: { text: string } } }).text._0.text}</span>
                  )}
                  {(variant === "fileTree" || variant === "portal") && (
                    <div className="note-placeholder">{variant === "fileTree" ? "file tree…" : "portal…"}</div>
                  )}
                </div>
              </>
            )}
            {sel &&
              HANDLES.map((h) => (
                <div key={h} className={`om-handle om-handle-${h}`} onMouseDown={(e) => startResize(e, n.id, h)} />
              ))}
          </div>
        );
      })}
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

import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CANVAS_INITIAL_ORIGIN,
  createEmptyWorkspace,
  decodeWorkspaceDocument,
  frameArrayToRect,
  rectToFrameArray,
  nodeDisplayName,
  nodeVariant,
  type CanvasNode,
  type FrameRect,
  type WorkspaceDocument,
} from "./lib/workspace-schema";
import { canvasToScreen, zoomAround, type Viewport } from "./lib/viewport";
import { createRope, tickRope, ropeToPath } from "./lib/rope";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const AUTOSAVE_MS = 30_000; // Constants.autosaveInterval

interface RopeState {
  id: string;
  d: string;
  status: "idle" | "communicating";
}

function nodeCenter(r: FrameRect) {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export default function App() {
  const [doc, setDoc] = useState<WorkspaceDocument | null>(null);
  const [viewport, setViewport] = useState<Viewport>({
    originX: CANVAS_INITIAL_ORIGIN.x,
    originY: CANVAS_INITIAL_ORIGIN.y,
    zoom: 1.0,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ropes, setRopes] = useState<RopeState[]>([]);
  const [status, setStatus] = useState("loading…");
  const [ipcPort, setIpcPort] = useState<number>(0);
  const docRef = useRef<WorkspaceDocument | null>(null);
  const viewRef = useRef(viewport);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const nodeDragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const spaceRef = useRef(false);

  docRef.current = doc;
  viewRef.current = viewport;

  // ---- load ---------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const port = await invoke<number>("ipc_port");
        setIpcPort(port);
        const raw = await invoke<unknown>("workspace_load", { workspaceId: WORKSPACE_ID });
        const decoded = decodeWorkspaceDocument(raw);
        setDoc(decoded);
        setViewport({
          originX: decoded.payload.canvasOrigin.x,
          originY: decoded.payload.canvasOrigin.y,
          zoom: decoded.payload.canvasZoom,
        });
        await invoke("workspace_set_active", { workspaceId: WORKSPACE_ID });
        setStatus(`workspace "${decoded.payload.name}" · IPC 127.0.0.1:${port}`);
      } catch (e) {
        setStatus(`load failed: ${String(e)}`);
        setDoc(createEmptyWorkspace("My Workspace", "C:\\"));
      }
    })();
  }, []);

  // ---- autosave (30s, mirrors Swift) ---------------------------------------
  const save = useCallback(async () => {
    const d = docRef.current;
    if (!d) return;
    const v = viewRef.current;
    const stamped: WorkspaceDocument = {
      ...d,
      payload: {
        ...d.payload,
        canvasOrigin: { x: v.originX, y: v.originY },
        canvasZoom: v.zoom,
        lastModifiedAt: new Date().toISOString(),
      },
    };
    try {
      await invoke("workspace_save", { workspaceId: WORKSPACE_ID, doc: stamped });
      setStatus(`saved ${new Date().toLocaleTimeString()} · IPC 127.0.0.1:${ipcPort}`);
    } catch (e) {
      setStatus(`save failed: ${String(e)}`);
    }
  }, [ipcPort]);

  useEffect(() => {
    const t = setInterval(save, AUTOSAVE_MS);
    return () => clearInterval(t);
  }, [save]);

  // ---- rope physics loop (60Hz) ---------------------------------------------
  useEffect(() => {
    if (!doc) return;
    const conns: { id: string; a: string; b: string }[] = [
      ...doc.payload.connections.map((c) => ({ id: c.id, a: c.terminalIdA, b: c.terminalIdB })),
      ...doc.payload.noteConnections.map((c) => ({ id: c.id, a: c.terminalId, b: c.noteNodeId })),
      ...doc.payload.portalConnections.map((c) => ({ id: c.id, a: c.terminalId, b: c.portalNodeId })),
    ];
    const byId = new Map(doc.payload.nodes.map((n) => [n.id, n]));
    // also match terminalId against TerminalContent.id
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
      return;
    }
    const nd = nodeDragRef.current;
    if (nd && doc) {
      const v = viewRef.current;
      const r = frameArrayToRect(doc.payload.nodes.find((n) => n.id === nd.id)!.frame);
      const nx = (e.clientX - nd.dx) / v.zoom + v.originX - r.w / 2;
      void nx;
    }
  };
  const onMouseUp = () => {
    dragRef.current = null;
    nodeDragRef.current = null;
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

  // ---- node ops ---------------------------------------------------------------
  const addNode = (kind: "terminal" | "stickyNote" | "text") => {
    if (!doc) return;
    const v = viewRef.current;
    const cx = v.originX + 400 / v.zoom;
    const cy = v.originY + 300 / v.zoom;
    const id = crypto.randomUUID();
    const frame = rectToFrameArray({ x: cx, y: cy, w: 420, h: kind === "text" ? 80 : 300 });
    const now = new Date().toISOString();
    let content: CanvasNode["content"];
    if (kind === "terminal") {
      content = {
        terminal: {
          _0: {
            agentType: "generic_shell",
            command: "",
            name: `Shell ${doc.payload.nodes.length + 1}`,
            icon: "terminal",
            color: "#8E8E93",
            id,
            shellPath: "powershell.exe",
            workingDirectory: doc.payload.workingDirectory,
            status: "idle",
            isManager: false,
            monitorWithOmbro: false,
            autoScrollLocked: false,
            shortcutMode: { kind: "automatic" },
            scrollbackLineCount: 0,
          },
        },
      };
    } else if (kind === "stickyNote") {
      content = {
        stickyNote: {
          _0: {
            color: "#FEFDE8",
            fileName: `Note-${id.slice(0, 8)}.md`,
            fontSize: 14,
            hasCustomName: false,
            isPreviewing: false,
            storageMode: { managed: {} },
          },
        },
      };
    } else {
      content = {
        text: {
          _0: {
            text: "New text",
            fontSize: 18,
            fontWeight: "regular",
            color: "#1a1a1a",
            alignment: "left",
            fontFamily: "sans",
          },
        },
      };
    }
    const node: CanvasNode = { id, frame, content, zIndex: 0, isLocked: false, createdAt: now, lastModifiedAt: now };
    setDoc({ ...doc, payload: { ...doc.payload, nodes: [...doc.payload.nodes, node] } });
  };

  const updateNodeFrame = (id: string, r: FrameRect) => {
    if (!doc) return;
    setDoc({
      ...doc,
      payload: {
        ...doc.payload,
        nodes: doc.payload.nodes.map((n) =>
          n.id === id ? { ...n, frame: rectToFrameArray(r), lastModifiedAt: new Date().toISOString() } : n,
        ),
      },
    });
  };

  if (!doc) return <main className="loading">{status}</main>;

  return (
    <main
      className="canvas-root"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      <div className="toolbar">
        <strong>open-maestri</strong>
        <span className="ws-name">{doc.payload.name}</span>
        <button onClick={() => addNode("terminal")}>+ Terminal</button>
        <button onClick={() => addNode("stickyNote")}>+ Note</button>
        <button onClick={() => addNode("text")}>+ Text</button>
        <button onClick={save}>Save</button>
        <span className="status">{status}</span>
      </div>
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
              e.stopPropagation();
              setSelected(new Set([n.id]));
              nodeDragRef.current = { id: n.id, dx: e.clientX, dy: e.clientY };
              const start = frameArrayToRect(n.frame);
              const move = (me: MouseEvent) => {
                const v = viewRef.current;
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
          >
            <div className="node-header">{nodeDisplayName(n.id, n.content)}</div>
            <div className="node-body">
              {variant === "terminal" && <div className="term-placeholder">powershell.exe — PTY em F4</div>}
              {variant === "stickyNote" && <div className="note-placeholder">note…</div>}
              {variant === "text" && (
                <span>{(n.content as { text: { _0: { text: string } } }).text._0.text}</span>
              )}
            </div>
          </div>
        );
      })}
      <div className="minimap">
        <Minimap doc={doc} viewport={viewport} onJump={(x, y) => setViewport((v) => ({ ...v, originX: x, originY: y }))} />
      </div>
    </main>
  );
}

function Minimap({
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

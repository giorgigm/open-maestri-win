import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import CanvasView from "./canvas/CanvasView";
import Sidebar from "./shell/Sidebar";
import ToolPill from "./shell/ToolPill";
import ZoomControls from "./shell/ZoomControls";
import ContextMenu, { type MenuItem } from "./shell/ContextMenu";
import WorkspaceModal from "./shell/WorkspaceModal";
import "./shell/shell.css";
import "./App.css";
import {
  CANVAS_INITIAL_ORIGIN,
  decodeWorkspaceDocument,
  rectToFrameArray,
  nodeVariant,
  type CanvasNode,
  type FrameRect,
  type WorkspaceDocument,
} from "./lib/workspace-schema";
import type { Viewport } from "./lib/viewport";
import {
  normalizeEntry,
  type AppStateData,
  type SidebarLayout,
  type ToolId,
  type WorkspaceEntry,
  type WorkspaceManifest,
} from "./lib/manifest";

const AUTOSAVE_MS = 30_000;

interface MenuState {
  x: number;
  y: number;
  groups: MenuItem[][];
  nodeId: string | null;
}

export default function App() {
  const [manifest, setManifest] = useState<WorkspaceManifest | null>(null);
  const [layout, setLayout] = useState<SidebarLayout>({ schemaVersion: 2, topLevelItems: [], groups: [] });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [doc, setDoc] = useState<WorkspaceDocument | null>(null);
  const [viewport, setViewport] = useState<Viewport>({
    originX: CANVAS_INITIAL_ORIGIN.x,
    originY: CANVAS_INITIAL_ORIGIN.y,
    zoom: 1.0,
  });
  const [tool, setTool] = useState<ToolId>("select");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [modal, setModal] = useState<{ mode: "new" } | { mode: "edit"; entry: WorkspaceEntry } | null>(null);
  const [status, setStatus] = useState("loading…");
  const [ipcPort, setIpcPort] = useState(0);

  const docRef = useRef(doc);
  const viewRef = useRef(viewport);
  const activeRef = useRef(activeId);
  const manifestRef = useRef(manifest);
  docRef.current = doc;
  viewRef.current = viewport;
  activeRef.current = activeId;
  manifestRef.current = manifest;

  // ---- boot: manifest + app-state + active workspace --------------------------
  useEffect(() => {
    (async () => {
      try {
        const port = await invoke<number>("ipc_port");
        setIpcPort(port);
        const m = await invoke<WorkspaceManifest>("manifest_load");
        const lay = await invoke<SidebarLayout>("sidebar_load");
        const st = await invoke<AppStateData>("appstate_load");
        // first run: seed one workspace so the canvas is never empty
        if (m.workspaces.length === 0) {
          const id = crypto.randomUUID();
          const entry = normalizeEntry({
            id,
            name: "My Workspace",
            workingDirectory: "C:\\",
          } as unknown as Record<string, unknown>);
          m.workspaces.push(entry);
          lay.topLevelItems.push(id);
          await invoke("manifest_save", { manifest: m });
          await invoke("sidebar_save", { layout: lay });
        }
        setManifest(m);
        setLayout(lay);
        const pick = st.activeWorkspaceId && m.workspaces.some((w) => w.id === st.activeWorkspaceId)
          ? st.activeWorkspaceId
          : (lay.topLevelItems[0] ?? m.workspaces[0].id);
        await loadWorkspace(pick, port);
      } catch (e) {
        setStatus(`load failed: ${String(e)}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadWorkspace = async (id: string, port?: number) => {
    const raw = await invoke<unknown>("workspace_load", { workspaceId: id });
    const decoded = decodeWorkspaceDocument(raw);
    setDoc(decoded);
    setViewport({
      originX: decoded.payload.canvasOrigin.x,
      originY: decoded.payload.canvasOrigin.y,
      zoom: decoded.payload.canvasZoom,
    });
    setActiveId(id);
    await invoke("workspace_set_active", { workspaceId: id });
    const st = await invoke<AppStateData>("appstate_load");
    st.activeWorkspaceId = id;
    st.lastOpenedAt = new Date().toISOString();
    if (!st.recentWorkspaceIds.includes(id)) st.recentWorkspaceIds.unshift(id);
    await invoke("appstate_save", { state: st });
    setStatus(`workspace "${decoded.payload.name}" · IPC 127.0.0.1:${port ?? ipcPort}`);
  };

  // ---- save (autosave 30s + on switch) -----------------------------------------
  const saveDoc = useCallback(
    async (d?: WorkspaceDocument | null, wsId?: string) => {
      const target = d ?? docRef.current;
      const wid = wsId ?? activeRef.current;
      if (!target || !wid) return;
      const v = viewRef.current;
      const stamped: WorkspaceDocument = {
        ...target,
        payload: {
          ...target.payload,
          canvasOrigin: { x: v.originX, y: v.originY },
          canvasZoom: v.zoom,
          lastModifiedAt: new Date().toISOString(),
        },
      };
      try {
        await invoke("workspace_save", { workspaceId: wid, doc: stamped });
        setStatus(`saved ${new Date().toLocaleTimeString()} · IPC 127.0.0.1:${ipcPort}`);
      } catch (e) {
        setStatus(`save failed: ${String(e)}`);
      }
    },
    [ipcPort],
  );

  useEffect(() => {
    const t = setInterval(() => void saveDoc(), AUTOSAVE_MS);
    return () => clearInterval(t);
  }, [saveDoc]);

  const switchWorkspace = async (id: string) => {
    if (id === activeRef.current) return;
    await saveDoc();
    await loadWorkspace(id);
  };

  // ---- workspace CRUD ------------------------------------------------------------
  const createWorkspace = async (name: string, dir: string) => {
    const m = manifestRef.current;
    if (!m) return;
    const id = crypto.randomUUID();
    const entry = normalizeEntry({
      id,
      name,
      workingDirectory: dir,
      createdAt: new Date().toISOString(),
    } as unknown as Record<string, unknown>);
    const m2 = { ...m, workspaces: [...m.workspaces, entry] };
    const lay = { ...layout, topLevelItems: [...layout.topLevelItems, id] };
    await invoke("manifest_save", { manifest: m2 });
    await invoke("sidebar_save", { layout: lay });
    setManifest(m2);
    setLayout(lay);
    setModal(null);
    await switchWorkspace(id);
  };

  const editWorkspace = async (name: string, dir: string) => {
    const m = manifestRef.current;
    if (!m || modal?.mode !== "edit") return;
    const id = modal.entry.id;
    const m2 = {
      ...m,
      workspaces: m.workspaces.map((w) => (w.id === id ? { ...w, name, workingDirectory: dir } : w)),
    };
    await invoke("manifest_save", { manifest: m2 });
    setManifest(m2);
    setModal(null);
  };

  const deleteWorkspace = async (entry: WorkspaceEntry) => {
    const m = manifestRef.current;
    if (!m || m.workspaces.length <= 1) {
      setStatus("cannot delete the last workspace");
      return;
    }
    const m2 = { ...m, workspaces: m.workspaces.filter((w) => w.id !== entry.id) };
    const lay = {
      ...layout,
      topLevelItems: layout.topLevelItems.filter((id) => id !== entry.id),
    };
    await invoke("manifest_save", { manifest: m2 });
    await invoke("sidebar_save", { layout: lay });
    setManifest(m2);
    setLayout(lay);
    if (entry.id === activeRef.current) {
      await loadWorkspace(m2.workspaces[0].id);
    }
  };

  // ---- node ops -------------------------------------------------------------------
  const addNode = (kind: "terminal" | "stickyNote" | "text" | "fileTree" | "portal") => {
    const d = docRef.current;
    if (!d) return;
    const v = viewRef.current;
    const cx = v.originX + 400 / v.zoom;
    const cy = v.originY + 300 / v.zoom;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const isSmall = kind === "text";
    const frame = rectToFrameArray({ x: cx, y: cy, w: isSmall ? 260 : 420, h: isSmall ? 80 : 300 });
    let content: CanvasNode["content"];
    if (kind === "terminal") {
      content = {
        terminal: {
          _0: {
            agentType: "generic_shell",
            command: "",
            name: `Shell ${d.payload.nodes.length + 1}`,
            icon: "terminal",
            color: "#8E8E93",
            id,
            shellPath: "powershell.exe",
            workingDirectory: d.payload.workingDirectory,
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
    } else if (kind === "text") {
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
    } else if (kind === "fileTree") {
      content = { fileTree: { _0: { name: "Files", rootPath: d.payload.workingDirectory, viewMode: "list" } } };
    } else {
      content = {
        portal: {
          _0: {
            id,
            name: `Portal ${d.payload.nodes.length + 1}`,
            currentURL: "",
            source: {},
            status: "idle",
            chromeHidden: false,
            storageScope: "isolated",
          },
        },
      };
    }
    const node: CanvasNode = { id, frame, content, zIndex: 0, isLocked: false, createdAt: now, lastModifiedAt: now };
    setDoc({ ...d, payload: { ...d.payload, nodes: [...d.payload.nodes, node] } });
    setTool("select");
  };

  const updateNodeFrame = (id: string, r: FrameRect) => {
    const d = docRef.current;
    if (!d) return;
    setDoc({
      ...d,
      payload: {
        ...d.payload,
        nodes: d.payload.nodes.map((n) =>
          n.id === id ? { ...n, frame: rectToFrameArray(r), lastModifiedAt: new Date().toISOString() } : n,
        ),
      },
    });
  };

  const deleteNodes = (ids: string[]) => {
    const d = docRef.current;
    if (!d) return;
    const gone = new Set(ids);
    setDoc({
      ...d,
      payload: {
        ...d.payload,
        nodes: d.payload.nodes.filter((n) => !gone.has(n.id)),
      },
    });
  };

  const duplicateNode = (id: string) => {
    const d = docRef.current;
    if (!d) return;
    const src = d.payload.nodes.find((n) => n.id === id);
    if (!src) return;
    const nid = crypto.randomUUID();
    const r = { ...src, id: nid } as CanvasNode;
    const fr = r.frame;
    r.frame = [
      [fr[0][0] + 24, fr[0][1] + 24],
      [fr[1][0], fr[1][1]],
    ];
    r.createdAt = new Date().toISOString();
    r.lastModifiedAt = r.createdAt;
    setDoc({ ...d, payload: { ...d.payload, nodes: [...d.payload.nodes, r] } });
  };

  const selection = (): string[] => [
    ...((window as unknown as { __omSelection?: Set<string> }).__omSelection ?? []),
  ];

  // ---- context menus -----------------------------------------------------------------
  const nodeMenu = (nodeId: string): MenuItem[][] => {
    const d = docRef.current;
    const n = d?.payload.nodes.find((x) => x.id === nodeId);
    const variant: string = n ? nodeVariant(n.content) : "text";
    const isTerm = variant === "terminal";
    const isNote = variant === "stickyNote";
    const groups: MenuItem[][] = [
      [
        { id: "duplicate", label: "Duplicate" },
        { id: "rename", label: isTerm ? "Edit Terminal" : "Rename", disabled: !isTerm && !isNote },
      ],
    ];
    if (isTerm) {
      groups.push([
        { id: "role", label: "Assign Role" },
        { id: "maestro", label: "Enable Maestro" },
      ]);
    }
    if (isNote) {
      groups.push([{ id: "toggle-view", label: "Toggle Raw / Formatted" }]);
    }
    groups.push([{ id: "connect", label: "Connect" }]);
    groups.push([{ id: "delete", label: "Delete", danger: true }]);
    return groups;
  };

  const onMenuPick = (id: string, nodeId: string | null) => {
    if (id === "delete" && nodeId) deleteNodes([nodeId]);
    else if (id === "duplicate" && nodeId) duplicateNode(nodeId);
    else if (id === "connect") setTool("connection");
    else if (id === "rename" && nodeId) {
      const d = docRef.current;
      const n = d?.payload.nodes.find((x) => x.id === nodeId);
      if (n) setStatus(`rename "${n.id.slice(0, 8)}" — editor em canvas-core`);
    } else setStatus(`"${id}" em breve (módulo do nó)`);
  };

  // ---- global shortcuts (Windows: Ctrl) ------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "Escape") {
        setTool("select");
        setMenu(null);
        return;
      }
      if (e.ctrlKey && (e.key === "w" || e.key === "W")) {
        e.preventDefault();
        const sel = selection();
        if (sel.length > 0) deleteNodes(sel);
        return;
      }
      if (e.ctrlKey && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        setViewport((v) => ({ ...v, zoom: Math.min(3, v.zoom * 1.25) }));
        return;
      }
      if (e.ctrlKey && e.key === "-") {
        e.preventDefault();
        setViewport((v) => ({ ...v, zoom: Math.max(0.1, v.zoom / 1.25) }));
        return;
      }
      if (e.key === "\\") {
        const sel = selection();
        const d = docRef.current;
        const n = d?.payload.nodes.find((x) => x.id === sel[0]);
        if (n) {
          const v = viewRef.current;
          setViewport((vv) => ({
            ...vv,
            originX: n.frame[0][0] - 400 / v.zoom,
            originY: n.frame[0][1] - 300 / v.zoom,
          }));
        }
        return;
      }
      if (e.ctrlKey && e.key === "ArrowDown") {
        e.preventDefault();
        stepWorkspace(1);
        return;
      }
      if (e.ctrlKey && e.key === "ArrowUp") {
        e.preventDefault();
        stepWorkspace(-1);
        return;
      }
      if (!e.ctrlKey && !e.metaKey && (e.key === "l" || e.key === "L")) {
        if (selection().length > 0) setTool("connection");
        return;
      }
      if (!e.ctrlKey && !e.metaKey && (e.key === "p" || e.key === "P")) {
        setTool("portal");
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, layout]);

  const stepWorkspace = async (dir: 1 | -1) => {
    const m = manifestRef.current;
    const cur = activeRef.current;
    if (!m || !cur) return;
    const order = [...layout.topLevelItems, ...m.workspaces.map((w) => w.id).filter((id) => !layout.topLevelItems.includes(id))];
    const i = order.indexOf(cur);
    const next = order[(i + dir + order.length) % order.length];
    if (next) await switchWorkspace(next);
  };

  const pickTool = (t: ToolId) => {
    if (t === "drawing") {
      setStatus("drawing chega em canvas-core");
      return;
    }
    setTool(t);
  };

  if (!manifest || !doc) return <main className="loading">{status}</main>;

  return (
    <div className="om-shell">
      <Sidebar
        entries={manifest.workspaces}
        layout={layout}
        activeId={activeId}
        nodeCountByWs={new Map([[activeId ?? "", doc.payload.nodes.length]])}
        onSelect={(id) => void switchWorkspace(id)}
        onNew={() => setModal({ mode: "new" })}
        onEdit={(e) => setModal({ mode: "edit", entry: e })}
        onDelete={(e) => void deleteWorkspace(e)}
      />
      <div className="om-canvas-wrap">
        <ToolPill active={tool} onPick={pickTool} />
        <button
          className="om-open-editor"
          title="Open workspace folder in editor"
          onClick={() => {
            const dir = manifest.workspaces.find((w) => w.id === activeId)?.workingDirectory;
            if (dir) openPath(dir).catch((e) => setStatus(`open failed: ${String(e)}`));
          }}
        >
          Open in editor ⧉
        </button>
        <CanvasView
          doc={doc}
          viewport={viewport}
          setViewport={setViewport}
          updateNodeFrame={updateNodeFrame}
          tool={tool}
          setTool={setTool}
          onAddNode={addNode}
          onNodeContextMenu={(e, nodeId) =>
            setMenu({ x: e.clientX, y: e.clientY, groups: nodeMenu(nodeId), nodeId })
          }
          onCanvasContextMenu={(e) =>
            setMenu({
              x: e.clientX,
              y: e.clientY,
              groups: [
                [
                  { id: "add-terminal", label: "Add Terminal" },
                  { id: "add-note", label: "Add Note" },
                  { id: "add-text", label: "Add Text" },
                ],
              ],
              nodeId: null,
            })
          }
        />
        <ZoomControls
          doc={doc}
          viewport={viewport}
          onZoom={(f) => setViewport((v) => ({ ...v, zoom: Math.min(3, Math.max(0.1, v.zoom * f)) }))}
          onReset={() => setViewport((v) => ({ ...v, zoom: 1 }))}
          onJump={(x, y) => setViewport((v) => ({ ...v, originX: x, originY: y }))}
        />
        <div className="om-status">{status}</div>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          groups={menu.groups}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            if (menu.nodeId) onMenuPick(id, menu.nodeId);
            else if (id === "add-terminal") addNode("terminal");
            else if (id === "add-note") addNode("stickyNote");
            else if (id === "add-text") addNode("text");
          }}
        />
      )}
      {modal?.mode === "new" && (
        <WorkspaceModal onCancel={() => setModal(null)} onSave={(n, d) => void createWorkspace(n, d)} />
      )}
      {modal?.mode === "edit" && (
        <WorkspaceModal
          initial={modal.entry}
          onCancel={() => setModal(null)}
          onSave={(n, d) => void editWorkspace(n, d)}
        />
      )}
    </div>
  );
}

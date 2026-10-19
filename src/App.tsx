import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import CanvasView from "./canvas/CanvasView";
import Sidebar from "./shell/Sidebar";
import ToolPill from "./shell/ToolPill";
import ZoomControls from "./shell/ZoomControls";
import ContextMenu, { type MenuItem } from "./shell/ContextMenu";
import WorkspaceModal from "./shell/WorkspaceModal";
import NewTerminalModal, { type NewTerminalSpec } from "./nodes/NewTerminalModal";
import NewPortalModal from "./nodes/NewPortalModal";
import Settings from "./shell/Settings";
import Floors from "./shell/Floors";
import Routines from "./shell/Routines";
import { defaultPreferences, mergePreferences, type Preferences } from "./lib/preferences";
import "./shell/shell.css";
import "./App.css";
import {
  CANVAS_INITIAL_ORIGIN,
  decodeWorkspaceDocument,
  rectToFrameArray,
  nodeVariant,
  type CanvasNode,
  type FileTreeContent,
  type FrameRect,
  type PortalContent,
  type StickyNoteContent,
  type TerminalContent,
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
import { hasDup, pairKind } from "./lib/connections";

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
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showFloors, setShowFloors] = useState(false);
  const [showRoutines, setShowRoutines] = useState(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

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
        try {
          setPrefs(mergePreferences(await invoke<Partial<Preferences>>("prefs_load")));
        } catch {
          setPrefs(defaultPreferences());
        }
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

  // ---- save (autosave interval from prefs + on switch) ---------------------------
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
    const ms = Math.max(5, prefs?.autosaveIntervalSeconds ?? 30) * 1000;
    const t = setInterval(() => void saveDoc(), ms);
    return () => clearInterval(t);
  }, [saveDoc, prefs?.autosaveIntervalSeconds]);

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
  const buildContent = (
    kind: "terminal" | "stickyNote" | "text" | "fileTree" | "portal",
    d: WorkspaceDocument,
    id: string,
  ): CanvasNode["content"] => {
    if (kind === "terminal") {
      return {
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
      return {
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
      return {
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
      return { fileTree: { _0: { name: "Files", rootPath: d.payload.workingDirectory, viewMode: "list" } } };
    } else {
      return {
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
  };

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
    const node: CanvasNode = { id, frame, content: buildContent(kind, d, id), zIndex: 0, isLocked: false, createdAt: now, lastModifiedAt: now };
    setDoc({ ...d, payload: { ...d.payload, nodes: [...d.payload.nodes, node] } });
    setTool("select");
  };

  const addNodeAt = (kind: "terminal" | "stickyNote" | "text" | "fileTree" | "portal", rect: FrameRect) => {
    const d = docRef.current;
    if (!d) return;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const node: CanvasNode = { id, frame: rectToFrameArray(rect), content: buildContent(kind, d, id), zIndex: 0, isLocked: false, createdAt: now, lastModifiedAt: now };
    setDoc({ ...d, payload: { ...d.payload, nodes: [...d.payload.nodes, node] } });
    setTool("select");
  };

  const duplicateNodeCb = (id: string): { newId: string; rect: FrameRect } | null => {
    const d = docRef.current;
    if (!d) return null;
    const src = d.payload.nodes.find((n) => n.id === id);
    if (!src) return null;
    const nid = crypto.randomUUID();
    const now = new Date().toISOString();
    const fr = src.frame;
    const rect: FrameRect = { x: fr[0][0] + 24, y: fr[0][1] + 24, w: fr[1][0], h: fr[1][1] };
    const clone: CanvasNode = { ...src, id: nid, frame: rectToFrameArray(rect), createdAt: now, lastModifiedAt: now };
    setDoc({ ...d, payload: { ...d.payload, nodes: [...d.payload.nodes, clone] } });
    return { newId: nid, rect };
  };

  const deleteConnection = (connId: string) => {
    const d = docRef.current;
    if (!d) return;
    setDoc({
      ...d,
      payload: {
        ...d.payload,
        connections: d.payload.connections.filter((c) => c.id !== connId),
        noteConnections: d.payload.noteConnections.filter((c) => c.id !== connId),
        portalConnections: d.payload.portalConnections.filter((c) => c.id !== connId),
        noteToNoteConnections: d.payload.noteToNoteConnections.filter((c) => c.id !== connId),
        portalToPortalConnections: d.payload.portalToPortalConnections.filter((c) => c.id !== connId),
      },
    });
  };

  // ---- connections (5 Mac types) -------------------------------------------------------
  const [connectSource, setConnectSource] = useState<string | null>(null);

  const terminalKeyOf = (nodeId: string): string | null => {
    const d = docRef.current;
    const n = d?.payload.nodes.find((x) => x.id === nodeId);
    if (!n || nodeVariant(n.content) !== "terminal") return null;
    return (n.content as { terminal: { _0: TerminalContent } }).terminal._0.id;
  };

  const createConnection = (fromId: string, toId: string): string | null => {
    const d = docRef.current;
    if (!d || fromId === toId) return null;
    const a = d.payload.nodes.find((x) => x.id === fromId);
    const b = d.payload.nodes.find((x) => x.id === toId);
    if (!a || !b) return null;
    const kind = pairKind(nodeVariant(a.content), nodeVariant(b.content));
    if (!kind) {
      setStatus("cannot connect these node types");
      return null;
    }
    const now = new Date().toISOString();
    const ropePoints: number[][] = Array.from({ length: 21 }, () => [0, 0]);
    const id = crypto.randomUUID();
    const tA = terminalKeyOf(fromId);
    const tB = terminalKeyOf(toId);
    if (kind === "terminal") {
      if (!tA || !tB) return null;
      if (hasDup(d.payload.connections.map((c) => ({ a: c.terminalIdA, b: c.terminalIdB })), tA, tB)) return null;
      setDoc({ ...d, payload: { ...d.payload, connections: [...d.payload.connections, { id, createdAt: now, terminalIdA: tA, terminalIdB: tB, ropePoints }] } });
    } else if (kind === "note") {
      const t = tA ?? tB;
      const n = nodeVariant(a.content) === "stickyNote" ? fromId : toId;
      if (!t) return null;
      if (hasDup(d.payload.noteConnections.map((c) => ({ a: c.terminalId, b: c.noteNodeId })), t, n)) return null;
      setDoc({ ...d, payload: { ...d.payload, noteConnections: [...d.payload.noteConnections, { id, createdAt: now, terminalId: t, noteNodeId: n, ropePoints }] } });
    } else if (kind === "portal") {
      const t = tA ?? tB;
      const p = nodeVariant(a.content) === "portal" ? fromId : toId;
      if (!t) return null;
      if (hasDup(d.payload.portalConnections.map((c) => ({ a: c.terminalId, b: c.portalNodeId })), t, p)) return null;
      setDoc({ ...d, payload: { ...d.payload, portalConnections: [...d.payload.portalConnections, { id, createdAt: now, terminalId: t, portalNodeId: p, ropePoints }] } });
    } else if (kind === "noteToNote") {
      if (hasDup(d.payload.noteToNoteConnections.map((c) => ({ a: c.noteNodeIdA, b: c.noteNodeIdB })), fromId, toId)) return null;
      setDoc({ ...d, payload: { ...d.payload, noteToNoteConnections: [...d.payload.noteToNoteConnections, { id, createdAt: now, noteNodeIdA: fromId, noteNodeIdB: toId, ropePoints }] } });
    } else {
      if (hasDup(d.payload.portalToPortalConnections.map((c) => ({ a: c.portalIdA, b: c.portalIdB })), fromId, toId)) return null;
      setDoc({ ...d, payload: { ...d.payload, portalToPortalConnections: [...d.payload.portalToPortalConnections, { id, createdAt: now, portalIdA: fromId, portalIdB: toId, ropePoints }] } });
    }
    return id;
  };

  const enterConnectMode = () => {
    const sel = selection();
    if (sel.length === 0) {
      setStatus("select a terminal, note or portal first, then L");
      return;
    }
    setConnectSource(sel[0]);
    setTool("connection");
  };

  // pending terminal placement: drag-to-place captured rect, modal confirms spec
  const [pendingTerm, setPendingTerm] = useState<{ rect: FrameRect } | null>(null);
  const [pendingPortal, setPendingPortal] = useState<{ rect: FrameRect } | null>(null);

  const createPortal = (rect: FrameRect, url: string, name: string) => {
    const d = docRef.current;
    if (!d) return;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const node: CanvasNode = {
      id,
      frame: rectToFrameArray(rect),
      content: {
        portal: {
          _0: { id, name, currentURL: url, source: { url: { _0: url } }, status: "idle", chromeHidden: false, storageScope: "isolated" },
        },
      },
      zIndex: 0,
      isLocked: false,
      createdAt: now,
      lastModifiedAt: now,
    };
    setDoc({ ...d, payload: { ...d.payload, nodes: [...d.payload.nodes, node] } });
    setPendingPortal(null);
    setTool("select");
  };

  const onFileTreeRoot = (nodeId: string, root: string) => {
    const d = docRef.current;
    if (!d) return;
    setDoc({
      ...d,
      payload: {
        ...d.payload,
        nodes: d.payload.nodes.map((n) => {
          if (n.id !== nodeId || nodeVariant(n.content) !== "fileTree") return n;
          const c = (n.content as { fileTree: { _0: FileTreeContent } }).fileTree._0;
          return {
            ...n,
            content: { fileTree: { _0: { ...c, rootPath: root } } },
            lastModifiedAt: new Date().toISOString(),
          };
        }),
      },
    });
  };

  const navigatePortal = (nodeId: string, url: string) => {    const d = docRef.current;
    if (!d) return;
    setDoc({
      ...d,
      payload: {
        ...d.payload,
        nodes: d.payload.nodes.map((n) => {
          if (n.id !== nodeId || nodeVariant(n.content) !== "portal") return n;
          const c = (n.content as { portal: { _0: PortalContent } }).portal._0;
          return {
            ...n,
            content: { portal: { _0: { ...c, currentURL: url, source: { url: { _0: url } } } } },
            lastModifiedAt: new Date().toISOString(),
          };
        }),
      },
    });
  };

  // badges: terminal order by creation (mirrors Mac Cmd+number badges)
  const terminalBadges = new Map<string, number>();
  doc?.payload.nodes
    .filter((x) => nodeVariant(x.content) === "terminal")
    .forEach((x, i) => {
      if (i < 9) terminalBadges.set(x.id, i + 1);
    });

  const handleAddNodeAt = (kind: "terminal" | "stickyNote" | "text" | "fileTree" | "portal", rect: FrameRect) => {
    if (kind === "terminal") {
      setPendingTerm({ rect }); // modal confirms spec
      return;
    }
    if (kind === "portal") {
      setPendingPortal({ rect }); // modal asks URL + name
      return;
    }
    addNodeAt(kind, rect);
  };

  const createTerminalFromSpec = (rect: FrameRect, spec: NewTerminalSpec) => {
    const d = docRef.current;
    if (!d) return;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const content: CanvasNode["content"] = {
      terminal: {
        _0: {
          agentType: spec.preset.agentType,
          command: spec.preset.command,
          name: spec.name,
          icon: spec.preset.icon,
          color: spec.preset.color,
          id,
          shellPath: spec.preset.shellPath,
          workingDirectory: spec.workingDirectory,
          status: "idle",
          isManager: spec.isManager,
          monitorWithOmbro: spec.monitorActivity,
          autoScrollLocked: false,
          shortcutMode: { kind: "automatic" },
          assignedRoleId: spec.roleId,
          scrollbackLineCount: 0,
        },
      },
    };
    const node: CanvasNode = { id, frame: rectToFrameArray(rect), content, zIndex: 0, isLocked: false, createdAt: now, lastModifiedAt: now };
    setDoc({ ...d, payload: { ...d.payload, nodes: [...d.payload.nodes, node] } });
    setPendingTerm(null);
    setTool("select");
  };

  const toggleMaestro = (nodeId: string) => {
    const d = docRef.current;
    if (!d) return;
    setDoc({
      ...d,
      payload: {
        ...d.payload,
        nodes: d.payload.nodes.map((n) => {
          if (n.id !== nodeId || nodeVariant(n.content) !== "terminal") return n;
          const t = (n.content as { terminal: { _0: TerminalContent } }).terminal._0;
          return {
            ...n,
            content: { terminal: { _0: { ...t, isManager: !t.isManager } } },
            lastModifiedAt: new Date().toISOString(),
          };
        }),
      },
    });
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
    // delete underlying .md files for notes (mirrors Mac)
    for (const n of d.payload.nodes) {
      if (gone.has(n.id) && nodeVariant(n.content) === "stickyNote") {
        const c = (n.content as { stickyNote: { _0: StickyNoteContent } }).stickyNote._0;
        if (c.fileName && c.storageMode && "managed" in c.storageMode) {
          deleteNoteFile(c.fileName);
        }
      }
    }
    setDoc({
      ...d,
      payload: {
        ...d.payload,
        nodes: d.payload.nodes.filter((n) => !gone.has(n.id)),
        // disconnectAll: drop every connection touching a deleted node (Mac parity)
        connections: d.payload.connections.filter((c) => {
          const a = nodeIdOfTerminal(c.terminalIdA);
          const b = nodeIdOfTerminal(c.terminalIdB);
          return !(gone.has(c.terminalIdA) || gone.has(c.terminalIdB) || (a && gone.has(a)) || (b && gone.has(b)));
        }),
        noteConnections: d.payload.noteConnections.filter(
          (c) => !gone.has(c.noteNodeId) && !gone.has(c.terminalId) && !goneTerminal(c.terminalId, gone),
        ),
        portalConnections: d.payload.portalConnections.filter(
          (c) => !gone.has(c.portalNodeId) && !gone.has(c.terminalId) && !goneTerminal(c.terminalId, gone),
        ),
        noteToNoteConnections: d.payload.noteToNoteConnections.filter(
          (c) => !gone.has(c.noteNodeIdA) && !gone.has(c.noteNodeIdB),
        ),
        portalToPortalConnections: d.payload.portalToPortalConnections.filter(
          (c) => !gone.has(c.portalIdA) && !gone.has(c.portalIdB),
        ),
      },
    });
  };

  const nodeIdOfTerminal = (terminalKey: string): string | null => {
    const d = docRef.current;
    const n = d?.payload.nodes.find(
      (x) =>
        x.id === terminalKey ||
        (nodeVariant(x.content) === "terminal" &&
          (x.content as { terminal: { _0: TerminalContent } }).terminal._0.id === terminalKey),
    );
    return n ? n.id : null;
  };

  const goneTerminal = (terminalKey: string, gone: Set<string>): boolean => {
    const nid = nodeIdOfTerminal(terminalKey);
    return nid != null && gone.has(nid);
  };

  const deleteNoteFile = (fileName: string) => {
    const wid = activeRef.current;
    if (!wid) return;
    invoke("note_save", { workspaceId: wid, fileName, text: "" }).catch(() => {});
    // empty + remove via shell: use note_delete command
    invoke("note_delete", { workspaceId: wid, fileName }).catch(() => {});
  };

  const toggleNotePreview = (id: string) => {
    const d = docRef.current;
    if (!d) return;
    setDoc({
      ...d,
      payload: {
        ...d.payload,
        nodes: d.payload.nodes.map((n) => {
          if (n.id !== id || nodeVariant(n.content) !== "stickyNote") return n;
          const c = (n.content as { stickyNote: { _0: StickyNoteContent } }).stickyNote._0;
          return {
            ...n,
            content: { stickyNote: { _0: { ...c, isPreviewing: !c.isPreviewing } } },
            lastModifiedAt: new Date().toISOString(),
          };
        }),
      },
    });
  };

  const renameNote = (id: string, name: string) => {    const d = docRef.current;
    if (!d) return;
    setDoc({
      ...d,
      payload: {
        ...d.payload,
        nodes: d.payload.nodes.map((n) => {
          if (n.id !== id || nodeVariant(n.content) !== "stickyNote") return n;
          const c = (n.content as { stickyNote: { _0: StickyNoteContent } }).stickyNote._0;
          return {
            ...n,
            content: {
              stickyNote: { _0: { ...c, fileName: `${name}.md`, hasCustomName: true } },
            },
            lastModifiedAt: new Date().toISOString(),
          };
        }),
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
    else if (id === "connect" && nodeId) {
      const sel = selection();
      setConnectSource(sel.includes(nodeId) ? nodeId : nodeId);
      setTool("connection");
    }
    else if (id === "maestro" && nodeId) toggleMaestro(nodeId);
    else if (id === "role" && nodeId) {
      setStatus("Assign Role: use o terminal + tab Roles do modal (settings em breve)");
    } else if (id === "rename" && nodeId) {
      const d = docRef.current;
      const n = d?.payload.nodes.find((x) => x.id === nodeId);
      if (n) setStatus(`rename "${n.id.slice(0, 8)}" — editor em node-note/node-terminal`);
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
        enterConnectMode();
        return;
      }
      if (!e.ctrlKey && !e.metaKey && (e.key === "p" || e.key === "P")) {
        setTool("portal");
        return;
      }
      // Ctrl+1..9 focuses the Nth terminal by creation order (mirrors Mac Cmd+number)
      if (e.ctrlKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const d = docRef.current;
        const terms = d?.payload.nodes.filter((x) => nodeVariant(x.content) === "terminal") ?? [];
        const n = terms[parseInt(e.key, 10) - 1];
        if (n) {
          const v = viewRef.current;
          setViewport((vv) => ({
            ...vv,
            originX: n.frame[0][0] - 400 / v.zoom,
            originY: n.frame[0][1] - 300 / v.zoom,
          }));
          setStatus(`focused terminal ${e.key}`);
        }
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
        onOpenSettings={() => setShowSettings(true)}
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
          onAddNodeAt={handleAddNodeAt}
          terminalBadges={terminalBadges}
          onToggleNotePreview={toggleNotePreview}
          onRenameNote={renameNote}
          onNavigatePortal={navigatePortal}
          onFileTreeRoot={onFileTreeRoot}
          termFontSize={prefs?.terminalFontSize}
          termFontFamily={prefs?.terminalFontFamily}
          termTheme={prefs?.terminalTheme}
          onConnectNodes={createConnection}
          connectSource={connectSource}
          setConnectSource={setConnectSource}
          onDuplicateNode={duplicateNodeCb}
          onDeleteConnection={deleteConnection}
          onNodeContextMenu={(e, nodeId) =>
            setMenu({ x: e.clientX, y: e.clientY, groups: nodeMenu(nodeId), nodeId })
          }
          onRopeContextMenu={(e, connId) =>
            setMenu({
              x: e.clientX,
              y: e.clientY,
              groups: [[{ id: "delete-conn", label: "Delete", danger: true }]],
              nodeId: `conn:${connId}`,
            })
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
          onFloors={() => setShowFloors(true)}
          onRoutines={() => setShowRoutines(true)}
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
            if (menu.nodeId?.startsWith("conn:")) {
              if (id === "delete-conn") deleteConnection(menu.nodeId.slice(5));
            } else if (menu.nodeId) onMenuPick(id, menu.nodeId);
            else if (id === "add-terminal") addNode("terminal");
            else if (id === "add-note") addNode("stickyNote");
            else if (id === "add-text") addNode("text");
          }}
        />
      )}
      {showSettings && prefs && (
        <Settings initial={prefs} onClose={() => setShowSettings(false)} onChange={(p) => setPrefs(p)} />
      )}
      {showFloors && activeId && <Floors workspaceId={activeId} onClose={() => setShowFloors(false)} />}
      {showRoutines && (
        <Routines
          terminals={doc.payload.nodes
            .filter((x) => nodeVariant(x.content) === "terminal")
            .map((x) => ({
              id: (x.content as { terminal: { _0: TerminalContent } }).terminal._0.id,
              name: (x.content as { terminal: { _0: TerminalContent } }).terminal._0.name,
            }))}
          onClose={() => setShowRoutines(false)}
        />
      )}
      {pendingTerm && prefs && (
        <NewTerminalModal
          defaultDir={doc.payload.workingDirectory}
          presets={prefs.agentPresets.filter((a) => a.isActive)}
          roles={prefs.rolePresets.map((r) => ({ id: r.id, name: r.name, prompt: r.prompt }))}
          onCancel={() => {
            setPendingTerm(null);
            setTool("select");
          }}
          onCreate={(spec) => createTerminalFromSpec(pendingTerm.rect, spec)}
        />
      )}
      {pendingTerm && !prefs && (
        <NewTerminalModal
          defaultDir={doc.payload.workingDirectory}
          onCancel={() => {
            setPendingTerm(null);
            setTool("select");
          }}
          onCreate={(spec) => createTerminalFromSpec(pendingTerm.rect, spec)}
        />
      )}
      {pendingPortal && (
        <NewPortalModal
          onCancel={() => {
            setPendingPortal(null);
            setTool("select");
          }}
          onCreate={(url, name) => createPortal(pendingPortal.rect, url, name)}
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

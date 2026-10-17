/**
 * workspace.json schema mirror — Maestri v0.25.4 / open-maestri schemaVersion 2.
 *
 * Source of truth: C:\ia\open-maestri\Sources\Workspace\Models\
 *   WorkspaceDocument.swift, WorkspacePayload.swift, CanvasNode.swift,
 *   NodeContent.swift, CGRect+Frame.swift
 *
 * Rules (DO NOT break — Maestri binary compat):
 * - envelope: { payload, schemaVersion: 2, type: "workspace" }
 * - frame: [[x, y], [w, h]] (array-of-arrays, never an object)
 * - NodeContent: { "<variant>": { "_0": {...} } }
 * - all keys camelCase, dates ISO8601 UTC
 * - unknown/missing optional fields get tolerant defaults (see CanvasNodeLegacyDecodeTests)
 */

export const SCHEMA_VERSION = 2;
export const CANVAS_INITIAL_ORIGIN = { x: 9800, y: 8500 };
export const ROPE_CONTROL_POINT_COUNT = 21;

export type Point = { x: number; y: number };
/** Frame encoded as [[x, y], [w, h]] on the wire. */
export type FrameArray = [[number, number], [number, number]];
export type FrameRect = { x: number; y: number; w: number; h: number };

export function frameArrayToRect(f: FrameArray): FrameRect {
  return { x: f[0][0], y: f[0][1], w: f[1][0], h: f[1][1] };
}

export function rectToFrameArray(r: FrameRect): FrameArray {
  return [
    [r.x, r.y],
    [r.w, r.h],
  ];
}

export function isValidFrameArray(v: unknown): v is FrameArray {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    v.every(
      (row) =>
        Array.isArray(row) &&
        row.length === 2 &&
        row.every((n) => typeof n === "number" && Number.isFinite(n)),
    )
  );
}

// ---------------------------------------------------------------- NodeContent

export type ShortcutModeKind =
  | "automatic"
  | "none"
  | "cmd1"
  | "cmd2"
  | "cmd3"
  | "cmd4"
  | "cmd5"
  | "cmd6"
  | "cmd7"
  | "cmd8"
  | "cmd9";

export interface TerminalContent {
  agentType: string; // "claude_code" | "codex" | "gemini_cli" | "open_code" | "generic_shell"
  command: string;
  name: string;
  icon: string;
  color: string;
  id: string; // UUID
  shellPath: string;
  workingDirectory: string;
  status: string; // "running" | "idle"
  isManager: boolean;
  monitorWithOmbro: boolean;
  autoScrollLocked: boolean;
  shortcutMode: { kind: ShortcutModeKind };
  assignedRoleId?: string | null;
  scrollbackFile?: string | null;
  scrollbackLineCount: number;
  lastActiveAt?: string | null;
  themeId?: string | null;
  fontFamily?: string | null;
  fontSize?: number | null;
}

export interface StickyNoteContent {
  color: string;
  fileName?: string | null;
  fontSize: number;
  hasCustomName: boolean;
  isPreviewing: boolean;
  storageMode: { managed: Record<string, never> } | { custom: { _0: string } };
}

export interface PortalContent {
  id: string;
  name: string;
  currentURL: string;
  /** {} = none, { url: { _0 } } = url */
  source: Record<string, never> | { url: { _0: string } };
  status: string; // "idle" | "loading"
  chromeHidden: boolean;
  storageScope: string; // "isolated" | "shared"
}

export interface FileTreeContent {
  name: string;
  rootPath: string;
  viewMode: string; // "list" | "grid"
}

export interface TextContent {
  text: string;
  fontSize: number;
  fontWeight: string;
  color: string;
  alignment: string;
  fontFamily: string; // missing in old files -> "sans"
}

export interface ShapeContent {
  shapeType: "rect" | "ellipse" | "diamond";
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "dotted";
  fillStyle: "solid" | "none" | "hatched" | "crossHatched";
  text: string;
  fontSize: number;
  rotation: number;
}

export interface StrokeContent {
  strokeType: "line" | "arrow";
  startPoint: Point;
  endPoint: Point;
  controlPoint?: Point | null;
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "dotted";
}

export interface FreehandContent {
  freehandType: "pen" | "highlighter";
  points: Point[];
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  rotation: number;
}

export type NodeContent =
  | { terminal: { _0: TerminalContent } }
  | { stickyNote: { _0: StickyNoteContent } }
  | { portal: { _0: PortalContent } }
  | { fileTree: { _0: FileTreeContent } }
  | { text: { _0: TextContent } }
  | { shape: { _0: ShapeContent } }
  | { stroke: { _0: StrokeContent } }
  | { freehand: { _0: FreehandContent } };

export type NodeVariant = keyof NodeContent;

export function nodeVariant(c: NodeContent): NodeVariant {
  return Object.keys(c)[0] as NodeVariant;
}

const CONNECTABLE: ReadonlySet<string> = new Set(["terminal", "stickyNote", "portal"]);

export function isConnectable(c: NodeContent): boolean {
  return CONNECTABLE.has(nodeVariant(c));
}

export function nodeDisplayName(id: string, c: NodeContent): string {
  const v = nodeVariant(c);
  const inner = (c as Record<string, { _0: { name?: string; text?: string } }>)[v]._0;
  if (typeof inner.name === "string" && inner.name) return inner.name;
  if (typeof inner.text === "string" && inner.text) return inner.text.slice(0, 40);
  return id.slice(0, 8);
}

// ---------------------------------------------------------------- CanvasNode

export interface CanvasNode {
  id: string;
  frame: FrameArray;
  content: NodeContent;
  zIndex: number;
  isLocked: boolean;
  createdAt: string;
  lastModifiedAt: string;
}

/** Tolerant decode: fills Swift-side defaults for pre-v0.24 files. */
export function normalizeNode(raw: Record<string, unknown>): CanvasNode {
  const frame = raw.frame;
  if (!isValidFrameArray(frame)) throw new Error("dataCorrupted: invalid frame");
  if (typeof raw.id !== "string" || typeof raw.content !== "object" || raw.content === null) {
    throw new Error("dataCorrupted: invalid node");
  }
  const now = new Date().toISOString();
  return {
    id: raw.id,
    frame,
    content: raw.content as NodeContent,
    zIndex: typeof raw.zIndex === "number" ? raw.zIndex : 0,
    isLocked: typeof raw.isLocked === "boolean" ? raw.isLocked : false,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    lastModifiedAt: typeof raw.lastModifiedAt === "string" ? raw.lastModifiedAt : now,
  };
}

// ---------------------------------------------------------------- Connections

export interface BaseConnection {
  id: string;
  createdAt: string;
  ropePoints: number[][];
}

export interface TerminalConnection extends BaseConnection {
  terminalIdA: string;
  terminalIdB: string;
}

export interface NoteConnection extends BaseConnection {
  terminalId: string;
  noteNodeId: string;
}

export interface PortalConnection extends BaseConnection {
  terminalId: string;
  portalNodeId: string;
}

export interface PortalToPortalConnection extends BaseConnection {
  portalIdA: string;
  portalIdB: string;
}

export interface NoteToNoteConnection extends BaseConnection {
  noteNodeIdA: string;
  noteNodeIdB: string;
}

export interface CrossFloorConnection extends BaseConnection {
  nodeIdA: string;
  floorIdA?: string | null;
  nodeIdB: string;
  floorIdB?: string | null;
}

export interface FloorEntry {
  id: string;
  name: string;
  branchName: string;
  worktreePath: string;
  hooks: { setup: string[]; run: string[]; teardown: string[]; autoRunSetup: boolean };
  createdAt: string;
}

export interface Drawing {
  id: string;
  points: number[][];
  color: string;
  lineWidth: number;
  createdAt: string;
}

// ---------------------------------------------------------------- Payload

export interface WorkspacePayload {
  id: string;
  name: string;
  icon: string;
  isPinned: boolean;
  locationType: string;
  workingDirectory: string;
  preferredIDE: string;
  syncConfigFiles: boolean;
  canvasOrigin: Point;
  canvasZoom: number;
  nodes: CanvasNode[];
  connections: TerminalConnection[];
  noteConnections: NoteConnection[];
  portalConnections: PortalConnection[];
  portalToPortalConnections: PortalToPortalConnection[];
  noteToNoteConnections: NoteToNoteConnection[];
  crossFloorConnections: CrossFloorConnection[];
  floors: FloorEntry[];
  drawings: Drawing[];
  createdAt: string;
  lastOpenedAt?: string | null;
  lastModifiedAt: string;
}

export interface WorkspaceDocument {
  payload: WorkspacePayload;
  schemaVersion: number;
  type: "workspace";
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Decode a workspace.json with v1->v2 backfill (mirrors Migration_v1_to_v2.swift). */
export function decodeWorkspaceDocument(raw: unknown): WorkspaceDocument {
  if (typeof raw !== "object" || raw === null) throw new Error("invalid workspace document");
  const doc = raw as Record<string, unknown>;
  const p = (doc.payload ?? {}) as Record<string, unknown>;
  if (typeof p.name !== "string" || typeof p.workingDirectory !== "string") {
    throw new Error("invalid workspace payload");
  }
  const now = new Date().toISOString();
  const payload: WorkspacePayload = {
    id: typeof p.id === "string" ? p.id : crypto.randomUUID(),
    name: p.name,
    icon: typeof p.icon === "string" ? p.icon : "folder",
    isPinned: p.isPinned === true,
    locationType: typeof p.locationType === "string" ? p.locationType : "local",
    workingDirectory: p.workingDirectory,
    preferredIDE: typeof p.preferredIDE === "string" ? p.preferredIDE : "cursor",
    syncConfigFiles: p.syncConfigFiles === true,
    canvasOrigin:
      typeof p.canvasOrigin === "object" && p.canvasOrigin !== null
        ? (p.canvasOrigin as Point)
        : { ...CANVAS_INITIAL_ORIGIN },
    canvasZoom: typeof p.canvasZoom === "number" ? p.canvasZoom : 1.0,
    nodes: arr<Record<string, unknown>>(p.nodes).map(normalizeNode),
    connections: arr(p.connections),
    noteConnections: arr(p.noteConnections),
    portalConnections: arr(p.portalConnections),
    portalToPortalConnections: arr(p.portalToPortalConnections),
    noteToNoteConnections: arr(p.noteToNoteConnections),
    crossFloorConnections: arr(p.crossFloorConnections),
    floors: arr(p.floors),
    drawings: arr(p.drawings),
    createdAt: typeof p.createdAt === "string" ? p.createdAt : now,
    lastOpenedAt: typeof p.lastOpenedAt === "string" ? p.lastOpenedAt : null,
    lastModifiedAt: typeof p.lastModifiedAt === "string" ? p.lastModifiedAt : now,
  } as WorkspacePayload;
  return {
    payload,
    schemaVersion: 2,
    type: "workspace",
  };
}

export function createEmptyWorkspace(name: string, workingDirectory: string): WorkspaceDocument {
  const now = new Date().toISOString();
  return {
    payload: {
      id: crypto.randomUUID(),
      name,
      icon: "folder",
      isPinned: false,
      locationType: "local",
      workingDirectory,
      preferredIDE: "cursor",
      syncConfigFiles: false,
      canvasOrigin: { ...CANVAS_INITIAL_ORIGIN },
      canvasZoom: 1.0,
      nodes: [],
      connections: [],
      noteConnections: [],
      portalConnections: [],
      portalToPortalConnections: [],
      noteToNoteConnections: [],
      crossFloorConnections: [],
      floors: [],
      drawings: [],
      createdAt: now,
      lastOpenedAt: null,
      lastModifiedAt: now,
    },
    schemaVersion: SCHEMA_VERSION,
    type: "workspace",
  };
}

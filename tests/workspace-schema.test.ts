import { describe, expect, it } from "vitest";
import {
  CANVAS_INITIAL_ORIGIN,
  SCHEMA_VERSION,
  createEmptyWorkspace,
  decodeWorkspaceDocument,
  frameArrayToRect,
  isConnectable,
  isValidFrameArray,
  nodeDisplayName,
  nodeVariant,
  normalizeNode,
  rectToFrameArray,
  type CanvasNode,
} from "../src/lib/workspace-schema";
import fixture from "./fixtures/TestWorkspace.json";

describe("workspace.json contract (Maestri v0.25.4 / schemaVersion 2)", () => {
  it("decodes the Swift fixture with tolerant defaults", () => {
    const doc = decodeWorkspaceDocument(fixture);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.type).toBe("workspace");
    expect(doc.payload.name).toBe("Test Workspace");
    expect(doc.payload.canvasOrigin).toEqual({ x: 9800, y: 8500 });
    expect(doc.payload.canvasZoom).toBe(1.0);
    // v1->v2 backfill: missing arrays default to []
    expect(doc.payload.portalToPortalConnections).toEqual([]);
    expect(doc.payload.noteToNoteConnections).toEqual([]);
    expect(doc.payload.crossFloorConnections).toEqual([]);
    expect(doc.payload.floors).toEqual([]);
    expect(doc.payload.drawings).toEqual([]);
    expect(doc.payload.icon).toBe("folder");
    expect(doc.payload.isPinned).toBe(false);
  });

  it("frame codec is [[x,y],[w,h]] only", () => {
    expect(isValidFrameArray([[1, 2], [3, 4]])).toBe(true);
    expect(isValidFrameArray({ x: 1, y: 2, w: 3, h: 4 })).toBe(false);
    expect(isValidFrameArray([[1, 2]])).toBe(false);
    const r = frameArrayToRect([[10, 20], [300, 200]]);
    expect(r).toEqual({ x: 10, y: 20, w: 300, h: 200 });
    expect(rectToFrameArray(r)).toEqual([[10, 20], [300, 200]]);
  });

  it("normalizeNode fills pre-v0.24 defaults and rejects bad frames", () => {
    const n = normalizeNode({
      id: "abc",
      frame: [[0, 0], [100, 100]],
      content: { text: { _0: { text: "hi" } } },
    } as unknown as Record<string, unknown>);
    expect(n.zIndex).toBe(0);
    expect(n.isLocked).toBe(false);
    expect(() =>
      normalizeNode({ id: "x", frame: { x: 1 }, content: {} } as unknown as Record<string, unknown>),
    ).toThrow();
  });

  it("NodeContent variant rules match Swift isConnectable", () => {
    const term = { terminal: { _0: { name: "Builder" } } };
    const note = { stickyNote: { _0: { name: "Spec" } } };
    const portal = { portal: { _0: { name: "Browser" } } };
    const text = { text: { _0: { text: "label" } } };
    expect(nodeVariant(term as never)).toBe("terminal");
    expect(isConnectable(term as never)).toBe(true);
    expect(isConnectable(note as never)).toBe(true);
    expect(isConnectable(portal as never)).toBe(true);
    expect(isConnectable(text as never)).toBe(false);
    expect(nodeDisplayName("12345678-xxxx", term as never)).toBe("Builder");
  });

  it("TextContent fontFamily defaults to sans (legacy files)", () => {
    const n = normalizeNode({
      id: "t",
      frame: [[0, 0], [10, 10]],
      content: { text: { _0: { text: "a", fontSize: 18 } } },
    } as unknown as Record<string, unknown>);
    expect((n.content as { text: { _0: { fontFamily?: string } } }).text._0.fontFamily).toBeUndefined();
    // default applied at render time; decode must not crash on missing field
  });

  it("createEmptyWorkspace matches Swift init defaults", () => {
    const doc = createEmptyWorkspace("Demo", "C:\\work");
    expect(doc.schemaVersion).toBe(2);
    expect(doc.payload.canvasOrigin).toEqual(CANVAS_INITIAL_ORIGIN);
    expect(doc.payload.nodes).toEqual([]);
    expect(doc.payload.lastOpenedAt).toBeNull();
  });

  it("round-trips a CanvasNode through JSON", () => {
    const node: CanvasNode = {
      id: "00000000-0000-0000-0000-000000000042",
      frame: [[9800, 8500], [560, 380]],
      content: {
        terminal: {
          _0: {
            agentType: "generic_shell",
            command: "",
            name: "Shell",
            icon: "terminal",
            color: "#8E8E93",
            id: "00000000-0000-0000-0000-000000000042",
            shellPath: "powershell.exe",
            workingDirectory: "C:\\work",
            status: "idle",
            isManager: false,
            monitorWithOmbro: false,
            autoScrollLocked: false,
            shortcutMode: { kind: "automatic" },
            scrollbackLineCount: 0,
          },
        },
      },
      zIndex: 0,
      isLocked: false,
      createdAt: "2026-10-17T00:00:00.000Z",
      lastModifiedAt: "2026-10-17T00:00:00.000Z",
    };
    const back = normalizeNode(JSON.parse(JSON.stringify(node)));
    expect(back).toEqual(node);
  });
});

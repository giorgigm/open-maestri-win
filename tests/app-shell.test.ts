import { describe, expect, it } from "vitest";
import {
  SHORTCUTS,
  normalizeEntry,
  orderWorkspaces,
  type SidebarLayout,
  type WorkspaceEntry,
} from "../src/lib/manifest";

describe("app-shell manifest contract", () => {
  it("normalizeEntry tolerates legacy files without color", () => {
    const e = normalizeEntry({ id: "w1", name: "W" } as unknown as Record<string, unknown>);
    expect(e.color).toBe("blue");
    expect(e.icon).toBe("folder");
    expect(e.isPinned).toBe(false);
    expect(e.locationType).toBe("local");
    expect(e.lastOpenedAt).toBeNull();
  });

  it("orderWorkspaces respects topLevelItems then groups then leftovers", () => {
    const mk = (id: string): WorkspaceEntry => ({
      id,
      name: id,
      workingDirectory: "C:\\x",
      icon: "folder",
      color: "blue",
      isPinned: false,
      locationType: "local",
      createdAt: "2026-01-01T00:00:00Z",
      lastOpenedAt: null,
    });
    const entries = ["a", "b", "c", "d"].map(mk);
    const layout: SidebarLayout = {
      schemaVersion: 2,
      topLevelItems: ["b", "missing", "a"],
      groups: [{ id: "g1", name: "G", isCollapsed: false, items: ["c"] }],
    };
    const { ordered, grouped } = orderWorkspaces(entries, layout);
    expect(ordered.map((e) => e.id)).toEqual(["b", "a", "d"]);
    expect(grouped.get("g1")!.map((e) => e.id)).toEqual(["c"]);
  });

  it("shortcut map uses Ctrl on Windows", () => {
    expect(SHORTCUTS.deleteNode).toBe("Ctrl+W");
    expect(SHORTCUTS.startConnect).toBe("L");
    expect(SHORTCUTS.newPortal).toBe("P");
    expect(SHORTCUTS.cancelTool).toBe("Escape");
  });
});

import { describe, expect, it } from "vitest";
import { hasDup, pairKind } from "../src/lib/connections";

describe("connection pairs", () => {
  it("accepts the 5 Mac types", () => {
    expect(pairKind("terminal", "terminal")).toBe("terminal");
    expect(pairKind("terminal", "stickyNote")).toBe("note");
    expect(pairKind("stickyNote", "terminal")).toBe("note");
    expect(pairKind("terminal", "portal")).toBe("portal");
    expect(pairKind("portal", "portal")).toBe("portalToPortal");
    expect(pairKind("stickyNote", "stickyNote")).toBe("noteToNote");
  });
  it("rejects non-connectable endpoints", () => {
    expect(pairKind("text", "terminal")).toBeNull();
    expect(pairKind("fileTree", "terminal")).toBeNull();
    expect(pairKind("text", "text")).toBeNull();
    expect(pairKind("terminal", "text")).toBeNull();
  });
  it("detects duplicates regardless of order", () => {
    const list = [{ a: "x", b: "y" }];
    expect(hasDup(list, "x", "y")).toBe(true);
    expect(hasDup(list, "y", "x")).toBe(true);
    expect(hasDup(list, "x", "z")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

function parsePorcelain(out: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of out.split("\n")) {
    if (line.length < 4) continue;
    const code = line.slice(0, 2).trim() || "?";
    const path = line.slice(3).trim();
    map.set(path.split(" -> ").pop()!, code);
  }
  return map;
}

describe("filetree porcelain (Rust mirror)", () => {
  it("parses statuses incl. rename", () => {
    const m = parsePorcelain(" M edited.txt\nA  added.txt\n?? new.txt\nR  old.txt -> renamed.txt\n");
    expect(m.get("edited.txt")).toBe("M");
    expect(m.get("added.txt")).toBe("A");
    expect(m.get("new.txt")).toBe("??");
    expect(m.get("renamed.txt")).toBe("R");
  });
});

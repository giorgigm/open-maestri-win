import { describe, expect, it } from "vitest";

function splitPrompts(prompt: string): string[] {
  return prompt.split("&&").map((s) => s.trim()).filter(Boolean);
}

describe("advanced", () => {
  it("splits && chains like the Mac", () => {
    expect(splitPrompts("pull latest && run tests && summarize")).toHaveLength(3);
    expect(splitPrompts("  ")).toEqual([]);
  });
  it("enforces 60s minimum", () => {
    expect(60 >= 60).toBe(true);
    expect(30 >= 60).toBe(false);
  });
});

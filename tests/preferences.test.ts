import { describe, expect, it } from "vitest";
import { defaultPreferences, mergePreferences } from "../src/lib/preferences";

describe("preferences", () => {
  it("defaults match Swift init", () => {
    const p = defaultPreferences();
    expect(p.schemaVersion).toBe(1);
    expect(p.agentPresets).toHaveLength(5);
    expect(p.terminalFontSize).toBe(13);
    expect(p.autosaveIntervalSeconds).toBe(30);
  });
  it("merge keeps custom presets, fills gaps", () => {
    const m = mergePreferences({ language: "en", agentPresets: [] });
    expect(m.agentPresets).toEqual([]);
    expect(m.terminalTheme).toBe("dark");
  });
});

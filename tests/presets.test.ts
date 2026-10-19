import { describe, expect, it } from "vitest";
import { AGENT_PRESETS, BUILTIN_ROLES } from "../src/lib/presets";

describe("agent presets (Preferences.swift mirror)", () => {
  it("has the 5 built-in presets with valid agentTypes", () => {
    expect(AGENT_PRESETS).toHaveLength(5);
    const types = AGENT_PRESETS.map((p) => p.agentType).sort();
    expect(types).toEqual(["claude_code", "codex", "gemini_cli", "generic_shell", "open_code"]);
  });

  it("shell preset runs powershell on Windows", () => {
    const shell = AGENT_PRESETS.find((p) => p.id === "shell")!;
    expect(shell.shellPath).toBe("powershell.exe");
    expect(shell.command).toBe("");
  });

  it("all presets active, built-in, hex colors", () => {
    for (const p of AGENT_PRESETS) {
      expect(p.isActive).toBe(true);
      expect(p.isBuiltIn).toBe(true);
      expect(p.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("builtin roles cover the 4 Mac examples", () => {
    expect(BUILTIN_ROLES.map((r) => r.name).sort()).toEqual(["Coder", "Lead", "Reviewer", "Tester"]);
  });
});

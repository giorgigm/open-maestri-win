/** Preferences mirror — defaults match prefs.rs / Preferences.swift (Windows-adapted). */

export interface AgentPresetCfg {
  id: string;
  name: string;
  command: string;
  icon: string;
  agentType: string;
  color: string;
  isActive: boolean;
  isBuiltIn: boolean;
}

export interface RolePresetCfg {
  id: string;
  name: string;
  prompt: string;
  color: string;
  icon: string;
}

export interface Preferences {
  schemaVersion: number;
  agentPresets: AgentPresetCfg[];
  rolePresets: RolePresetCfg[];
  terminalFontFamily: string;
  terminalFontSize: number;
  terminalTheme: string;
  canvasBackground: string;
  defaultNoteColor: string;
  preferredIDE: string;
  language: string;
  shortcuts: Record<string, unknown>;
  sshEnabled: boolean;
  sshTunnelPort: number;
  sshHost: string;
  sshUser: string;
  sshPort: number;
  scrollbackMemoryLimit: boolean;
  autosaveIntervalSeconds: number;
}

export function defaultPreferences(): Preferences {
  const p = (id: string, name: string, command: string, icon: string, agentType: string, color: string): AgentPresetCfg => ({
    id, name, command, icon, agentType, color, isActive: true, isBuiltIn: true,
  });
  return {
    schemaVersion: 1,
    agentPresets: [
      p("claude-code", "Claude Code", "claude", "seal", "claude_code", "#007AFF"),
      p("codex", "Codex", "codex", "brain", "codex", "#5856D6"),
      p("gemini", "Gemini CLI", "gemini", "sparkle", "gemini_cli", "#34C759"),
      p("opencode", "OpenCode", "opencode", "rect", "open_code", "#FF9500"),
      p("shell", "Shell", "", "terminal", "generic_shell", "#8E8E93"),
    ],
    rolePresets: [],
    terminalFontFamily: "system",
    terminalFontSize: 13,
    terminalTheme: "dark",
    canvasBackground: "dotGrid",
    defaultNoteColor: "#FEFDE8",
    preferredIDE: "cursor",
    language: "en",
    shortcuts: {},
    sshEnabled: false,
    sshTunnelPort: 7433,
    sshHost: "",
    sshUser: "",
    sshPort: 22,
    scrollbackMemoryLimit: false,
    autosaveIntervalSeconds: 30,
  };
}

/** Tolerant merge: server already merges; this guards invoke-mocks in tests. */
export function mergePreferences(raw: Partial<Preferences>): Preferences {
  const d = defaultPreferences();
  return {
    ...d,
    ...raw,
    agentPresets: raw.agentPresets ?? d.agentPresets,
    rolePresets: raw.rolePresets ?? d.rolePresets,
    shortcuts: (raw.shortcuts as Record<string, unknown>) ?? {},
  };
}

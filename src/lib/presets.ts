/** Agent presets — mirrors Preferences.swift:86-103. Shell preset uses powershell.exe on Windows. */

export interface AgentPreset {
  id: string;
  name: string;
  command: string;
  icon: string;
  agentType: string;
  color: string;
  isActive: boolean;
  isBuiltIn: boolean;
  shellPath: string;
}

export const AGENT_PRESETS: AgentPreset[] = [
  { id: "claude-code", name: "Claude Code", command: "claude", icon: "seal", agentType: "claude_code", color: "#007AFF", isActive: true, isBuiltIn: true, shellPath: "powershell.exe" },
  { id: "codex", name: "Codex", command: "codex", icon: "brain", agentType: "codex", color: "#5856D6", isActive: true, isBuiltIn: true, shellPath: "powershell.exe" },
  { id: "gemini", name: "Gemini CLI", command: "gemini", icon: "sparkle", agentType: "gemini_cli", color: "#34C759", isActive: true, isBuiltIn: true, shellPath: "powershell.exe" },
  { id: "opencode", name: "OpenCode", command: "opencode", icon: "rect", agentType: "open_code", color: "#FF9500", isActive: true, isBuiltIn: true, shellPath: "powershell.exe" },
  { id: "shell", name: "Shell", command: "", icon: "terminal", agentType: "generic_shell", color: "#8E8E93", isActive: true, isBuiltIn: true, shellPath: "powershell.exe" },
];

export interface RolePreset {
  id: string;
  name: string;
  prompt: string;
}

/** Built-in role stubs from reference-index §4 until settings lands. */
export const BUILTIN_ROLES: RolePreset[] = [
  { id: "lead", name: "Lead", prompt: "Coordinate: split tasks across agents." },
  { id: "coder", name: "Coder", prompt: "Focused code implementation." },
  { id: "reviewer", name: "Reviewer", prompt: "Code review and critique." },
  { id: "tester", name: "Tester", prompt: "Write and run tests." },
];

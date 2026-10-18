/**
 * Manifest / sidebar-layout / app-state mirrors — Mac field-for-field.
 * Sources: AppState+Models.swift, SidebarLayout.swift (C:\ia\open-maestri).
 */

export interface WorkspaceEntry {
  id: string;
  name: string;
  workingDirectory: string;
  icon: string;
  color: string; // missing in legacy files -> "blue"
  isPinned: boolean;
  locationType: string;
  createdAt: string;
  lastOpenedAt?: string | null;
}

export interface WorkspaceManifest {
  schemaVersion: number;
  type: string;
  app: string;
  appVersion: string;
  dataFormat: number;
  workspaces: WorkspaceEntry[];
  files: Record<string, string>;
}

export interface SidebarGroup {
  id: string;
  name: string;
  isCollapsed: boolean;
  items: string[];
}

export interface SidebarLayout {
  schemaVersion: number;
  topLevelItems: string[];
  groups: SidebarGroup[];
}

export interface AppStateData {
  schemaVersion: number;
  type: string;
  activeWorkspaceId?: string | null;
  hasCompletedOnboarding: boolean;
  hasSeenFloorOnboarding: boolean;
  cleanShutdown: boolean;
  lastOpenedAt?: string | null;
  recentWorkspaceIds: string[];
}

export function normalizeEntry(raw: Record<string, unknown>): WorkspaceEntry {
  if (typeof raw.id !== "string" || typeof raw.name !== "string") {
    throw new Error("invalid workspace entry");
  }
  const now = new Date().toISOString();
  return {
    id: raw.id,
    name: raw.name,
    workingDirectory: typeof raw.workingDirectory === "string" ? raw.workingDirectory : "",
    icon: typeof raw.icon === "string" ? raw.icon : "folder",
    color: typeof raw.color === "string" ? raw.color : "blue",
    isPinned: raw.isPinned === true,
    locationType: typeof raw.locationType === "string" ? raw.locationType : "local",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    lastOpenedAt: typeof raw.lastOpenedAt === "string" ? raw.lastOpenedAt : null,
  };
}

/** Order entries by topLevelItems, then groups, then leftovers (stable). */
export function orderWorkspaces(
  entries: WorkspaceEntry[],
  layout: SidebarLayout,
): { ordered: WorkspaceEntry[]; grouped: Map<string, WorkspaceEntry[]> } {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const ordered: WorkspaceEntry[] = [];
  const seen = new Set<string>();
  for (const id of layout.topLevelItems) {
    const e = byId.get(id);
    if (e && !seen.has(id)) {
      ordered.push(e);
      seen.add(id);
    }
  }
  const grouped = new Map<string, WorkspaceEntry[]>();
  for (const g of layout.groups) {
    grouped.set(
      g.id,
      g.items.flatMap((id) => {
        const e = byId.get(id);
        return e && !seen.has(id) ? (seen.add(id), [e]) : [];
      }),
    );
  }
  for (const e of entries) {
    if (!seen.has(e.id)) {
      ordered.push(e);
      seen.add(e.id);
    }
  }
  return { ordered, grouped };
}

/** Windows shortcut map (Mac uses Cmd; Windows uses Ctrl). */
export const SHORTCUTS = {
  deleteNode: "Ctrl+W",
  zoomIn: "Ctrl+=",
  zoomOut: "Ctrl+-",
  focusNode: "\\",
  prevWorkspace: "Ctrl+ArrowUp",
  nextWorkspace: "Ctrl+ArrowDown",
  startConnect: "L",
  newPortal: "P",
  cancelTool: "Escape",
  duplicateDrag: "Ctrl+Drag",
} as const;

export type ToolId =
  | "select"
  | "terminal"
  | "note"
  | "text"
  | "drawing"
  | "file"
  | "portal"
  | "connection";

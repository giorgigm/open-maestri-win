/** Connection pair validation — mirrors ConnectionManager types + isConnectable. */
import type { NodeVariant } from "./workspace-schema";

export type PairKind = "terminal" | "note" | "portal" | "portalToPortal" | "noteToNote";

export function pairKind(a: NodeVariant, b: NodeVariant): PairKind | null {
  const pair = [a, b].sort().join("+");
  if (a === b) {
    if (a === "terminal") return "terminal";
    if (a === "portal") return "portalToPortal";
    if (a === "stickyNote") return "noteToNote";
    return null;
  }
  if (pair === "stickyNote+terminal") return "note";
  if (pair === "portal+terminal") return "portal";
  return null;
}

export interface ConnEndpoints {
  kind: PairKind;
  /** normalized [endpointA, endpointB] following payload field order */
  a: string;
  b: string;
}

/** Duplicate check across a connection list of one array. */
export function hasDup(list: { a: string; b: string }[], a: string, b: string): boolean {
  return list.some((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
}

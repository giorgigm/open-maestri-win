/**
 * Magnetic tile snapping — pure canvas-coordinate logic (no DOM).
 * Mac behavior: no fixed grid; wall-align to neighbor edges + gap-fill;
 * activated with Alt+drag. Tolerance passed in canvas units by caller
 * (6px screen / zoom).
 */
import type { FrameRect } from "../lib/workspace-schema";

export interface Guide {
  orientation: "v" | "h";
  /** canvas position of the guide line */
  pos: number;
  from: number;
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

function pickBest(cands: { d: number; guide: Guide }[], tol: number): { d: number; guide: Guide } | null {
  let best: { d: number; guide: Guide } | null = null;
  for (const c of cands) {
    if (Math.abs(c.d) <= tol && (best === null || Math.abs(c.d) < Math.abs(best.d))) best = c;
  }
  return best;
}

export function snapRect(moving: FrameRect, others: FrameRect[], tol: number): SnapResult {
  const guides: Guide[] = [];
  let dx = 0;
  let dy = 0;

  const mEdgesX = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const mEdgesY = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

  const xCands: { d: number; guide: Guide }[] = [];
  const yCands: { d: number; guide: Guide }[] = [];

  for (const o of others) {
    if (o.x === moving.x && o.y === moving.y && o.w === moving.w && o.h === moving.h) continue;
    const oEdgesX = [o.x, o.x + o.w / 2, o.x + o.w];
    const oEdgesY = [o.y, o.y + o.h / 2, o.y + o.h];
    for (const oe of oEdgesX) {
      for (const me of mEdgesX) {
        xCands.push({
          d: oe - me,
          guide: { orientation: "v", pos: oe, from: Math.min(moving.y, o.y), to: Math.max(moving.y + moving.h, o.y + o.h) },
        });
      }
    }
    for (const oe of oEdgesY) {
      for (const me of mEdgesY) {
        yCands.push({
          d: oe - me,
          guide: { orientation: "h", pos: oe, from: Math.min(moving.x, o.x), to: Math.max(moving.x + moving.w, o.x + o.w) },
        });
      }
    }
  }

  // gap-fill: center `moving` in the gap between two horizontally adjacent others
  for (let i = 0; i < others.length; i++) {
    for (let j = 0; j < others.length; j++) {
      if (i === j) continue;
      const a = others[i];
      const b = others[j];
      if (a.x + a.w <= b.x) {
        const vOverlap = moving.y < Math.max(a.y + a.h, b.y + b.h) && moving.y + moving.h > Math.min(a.y, b.y);
        if (vOverlap) {
          const targetCx = (a.x + a.w + b.x) / 2;
          xCands.push({
            d: targetCx - (moving.x + moving.w / 2),
            guide: { orientation: "v", pos: targetCx, from: Math.min(a.y, b.y), to: Math.max(a.y + a.h, b.y + b.h) },
          });
        }
      }
      if (a.y + a.h <= b.y) {
        const hOverlap = moving.x < Math.max(a.x + a.w, b.x + b.w) && moving.x + moving.w > Math.min(a.x, b.x);
        if (hOverlap) {
          const targetCy = (a.y + a.h + b.y) / 2;
          yCands.push({
            d: targetCy - (moving.y + moving.h / 2),
            guide: { orientation: "h", pos: targetCy, from: Math.min(a.x, b.x), to: Math.max(a.x + a.w, b.x + b.w) },
          });
        }
      }
    }
  }

  const bx = pickBest(xCands, tol);
  if (bx) {
    dx = bx.d;
    guides.push(bx.guide);
  }
  const by = pickBest(yCands, tol);
  if (by) {
    dy = by.d;
    guides.push(by.guide);
  }
  return { dx, dy, guides };
}

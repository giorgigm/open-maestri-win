/**
 * Rope simulation — direct port of Sources/Canvas/Physics/RopeSimulation.swift:
 * Verlet integration, gravity 0.8, damping 0.98, 5 constraint iterations,
 * sleep below 0.1 total movement, wake above 0.5 endpoint delta.
 */

export const ROPE_POINTS = 21;
const GRAVITY = 0.8;
const DAMPING = 0.98;
const ITERATIONS = 5;
const SLEEP_EPS = 0.1;
const WAKE_EPS = 0.5;

export interface Rope {
  points: { x: number; y: number }[];
  prev: { x: number; y: number }[];
  segLen: number;
  sleeping: boolean;
}

export function createRope(ax: number, ay: number, bx: number, by: number): Rope {
  const points = [];
  const prev = [];
  for (let i = 0; i < ROPE_POINTS; i++) {
    const t = i / (ROPE_POINTS - 1);
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    points.push({ x, y });
    prev.push({ x, y });
  }
  const dist = Math.hypot(bx - ax, by - ay);
  const bend = 1.1; // mid of ropeBendRatioMin..Max
  return { points, prev, segLen: (dist * bend) / (ROPE_POINTS - 1), sleeping: false };
}

/** One 60Hz tick. Returns true if still moving. */
export function tickRope(
  rope: Rope,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  // wake check
  const endMove =
    Math.hypot(rope.points[0].x - ax, rope.points[0].y - ay) +
    Math.hypot(
      rope.points[ROPE_POINTS - 1].x - bx,
      rope.points[ROPE_POINTS - 1].y - by,
    );
  if (rope.sleeping && endMove < WAKE_EPS) return false;
  rope.sleeping = false;

  rope.points[0] = { x: ax, y: ay };
  rope.points[ROPE_POINTS - 1] = { x: bx, y: by };

  let totalMove = 0;
  for (let i = 1; i < ROPE_POINTS - 1; i++) {
    const p = rope.points[i];
    const q = rope.prev[i];
    const vx = (p.x - q.x) * DAMPING;
    const vy = (p.y - q.y) * DAMPING;
    rope.prev[i] = { ...p };
    p.x += vx;
    p.y += vy + GRAVITY;
    totalMove += Math.abs(vx) + Math.abs(vy + GRAVITY);
  }
  for (let k = 0; k < ITERATIONS; k++) {
    for (let i = 0; i < ROPE_POINTS - 1; i++) {
      const a = rope.points[i];
      const b = rope.points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      const diff = (d - rope.segLen) / d;
      if (i === 0) {
        b.x -= dx * diff;
        b.y -= dy * diff;
      } else if (i === ROPE_POINTS - 2) {
        a.x += dx * diff;
        a.y += dy * diff;
      } else {
        const f = diff / 2;
        a.x += dx * f;
        a.y += dy * f;
        b.x -= dx * f;
        b.y -= dy * f;
      }
    }
  }
  rope.points[0] = { x: ax, y: ay };
  rope.points[ROPE_POINTS - 1] = { x: bx, y: by };
  if (totalMove < SLEEP_EPS) {
    rope.sleeping = true;
    return false;
  }
  return true;
}

/** Catmull-Rom -> SVG path (mirrors RopePathRenderer Catmull-Rom -> NSBezierPath). */
export function ropeToPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

import { describe, expect, it } from "vitest";
import { snapRect } from "../src/canvas/snap";
import type { FrameRect } from "../src/lib/workspace-schema";

const TOL = 6;
const r = (x: number, y: number, w = 100, h = 80): FrameRect => ({ x, y, w, h });

describe("magnetic snap", () => {
  it("aligns left edge to neighbor right edge", () => {
    const out = snapRect(r(203, 0), [r(100, 0)], TOL);
    expect(out.dx).toBe(-3); // 200 - 203
    expect(out.guides.some((g) => g.orientation === "v" && g.pos === 200)).toBe(true);
  });

  it("aligns centers", () => {
    // moving center-x 250 -> neighbor center-x 250
    const out = snapRect(r(202, 0, 100, 80), [r(100, 0, 300, 80)], TOL);
    expect(out.dx).toBe(-2);
  });

  it("no snap beyond tolerance", () => {
    const out = snapRect(r(210, 50), [r(100, 0)], TOL);
    expect(out.dx).toBe(0);
    expect(out.guides).toEqual([]);
  });

  it("picks smallest delta among candidates", () => {
    // moving left 103 vs neighbor [100..206]: L-L=-3, R-R=+3, C-C=0 -> picks 0? no:
    // use asymmetric: moving [104..204] vs neighbor [100..200]: L-L=-4, R-R=-4, C-C=-4...
    // cleaner: moving [103..203] vs neighbor [100..205]: L-L=-3, R-R=+2, C-C=-0.5 -> picks -0.5 (center, smallest)
    const out = snapRect(r(103, 50, 100, 80), [r(100, 50, 105, 80)], TOL);
    expect(out.dx).toBe(-0.5);
  });

  it("gap-fill centers between two neighbors", () => {
    const a = r(0, 0, 100, 80);
    const b = r(300, 0, 100, 80);
    const out = snapRect(r(140, 0, 100, 80), [a, b], TOL + 20);
    // gap center = 200, moving center = 190 -> dx +10
    expect(out.dx).toBe(10);
  });

  it("snaps vertically independent of horizontal", () => {
    const out = snapRect(r(500, 83), [r(0, 0, 50, 80)], TOL);
    expect(out.dx).toBe(0);
    expect(out.dy).toBe(-3); // 80 - 83
  });
});

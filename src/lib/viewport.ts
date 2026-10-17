/**
 * Viewport math — mirrors CanvasViewportView.swift screenToCanvas/canvasRectToScreen:
 *   screen = (canvas - origin) * zoom
 */

export interface Viewport {
  originX: number;
  originY: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 3.0;
export const ZOOM_STEP = 0.25;
export const GRID_SPACING = 16;

export function screenToCanvas(sx: number, sy: number, v: Viewport) {
  return { x: sx / v.zoom + v.originX, y: sy / v.zoom + v.originY };
}

export function canvasToScreen(cx: number, cy: number, v: Viewport) {
  return { x: (cx - v.originX) * v.zoom, y: (cy - v.originY) * v.zoom };
}

export function clampZoom(z: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Zoom around a screen-space cursor (mirrors magnify-around-cursor). */
export function zoomAround(v: Viewport, cursorX: number, cursorY: number, factor: number): Viewport {
  const zoom = clampZoom(v.zoom * factor);
  const before = screenToCanvas(cursorX, cursorY, v);
  const originX = before.x - cursorX / zoom;
  const originY = before.y - cursorY / zoom;
  return { originX, originY, zoom };
}

import { useState } from "react";
import { Minimap } from "../canvas/CanvasView";
import type { WorkspaceDocument } from "../lib/workspace-schema";
import type { Viewport } from "../lib/viewport";

interface ZoomControlsProps {
  doc: WorkspaceDocument;
  viewport: Viewport;
  onZoom: (f: number) => void;
  onReset: () => void;
  onJump: (x: number, y: number) => void;
}

export default function ZoomControls({ doc, viewport, onZoom, onReset, onJump }: ZoomControlsProps) {
  const [showMap, setShowMap] = useState(false);
  const pct = Math.round(viewport.zoom * 100);
  return (
    <div className="om-zoombar">
      <button title="Layers (soon)">⧉</button>
      <button title="Toggle minimap" onClick={() => setShowMap((s) => !s)}>
        ▦
      </button>
      <button title="Zoom out (Ctrl+-)" onClick={() => onZoom(1 / 1.25)}>
        −
      </button>
      <button className="om-zoom-pct" title="Reset to 100%" onClick={onReset}>
        {pct}%
      </button>
      <button title="Zoom in (Ctrl+=)" onClick={() => onZoom(1.25)}>
        +
      </button>
      {showMap && (
        <div className="om-map-pop">
          <Minimap doc={doc} viewport={viewport} onJump={onJump} />
        </div>
      )}
    </div>
  );
}

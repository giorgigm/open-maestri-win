import { useEffect, useRef } from "react";

export interface MenuItem {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
}

export default function ContextMenu({
  x,
  y,
  groups,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  groups: MenuItem[][];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  // clamp inside viewport
  const W = 210;
  const H = groups.length * 34 + (groups.length - 1) * 9;
  const cx = Math.min(x, window.innerWidth - W - 8);
  const cy = Math.min(y, window.innerHeight - H - 8);

  return (
    <div ref={ref} className="om-menu" style={{ left: cx, top: cy, width: W }}>
      {groups.map((g, i) => (
        <div key={i}>
          {i > 0 && <div className="om-menu-sep" />}
          {g.map((item) => (
            <button
              key={item.id}
              className={`om-menu-item ${item.danger ? "danger" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                onPick(item.id);
                onClose();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

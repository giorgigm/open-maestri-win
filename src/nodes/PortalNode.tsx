import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { PortalContent } from "../lib/workspace-schema";

/** Portal chrome: url bar + nav + iframe (estágio 1; X-Frame fallback honesto). */
export default function PortalNode({
  content,
  onNavigate,
}: {
  content: PortalContent;
  onNavigate: (url: string) => void;
}) {
  const [draft, setDraft] = useState(content.currentURL);
  const [loading, setLoading] = useState(!!content.currentURL);
  const [blocked, setBlocked] = useState(false);

  const go = (raw: string) => {
    const url = normalizeUrl(raw);
    if (!url) return;
    setDraft(url);
    setLoading(true);
    setBlocked(false);
    onNavigate(url);
  };

  return (
    <div className="portal-node">
      <div className="portal-bar">
        <button title="Back" onClick={() => window.history.back()}>‹</button>
        <button title="Forward" onClick={() => window.history.forward()}>›</button>
        <button title="Reload" onClick={() => content.currentURL && go(content.currentURL)}>⟳</button>
        <button title="Página em branco? Abrir fora (site bloqueia embed)" onClick={() => setBlocked(true)}>⧉</button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go(draft);
          }}
          placeholder="https://…"
          spellCheck={false}
        />
        {loading && <span className="portal-spin" title="loading" />}
      </div>
      <div className="portal-page">
        {content.currentURL ? (
          blocked ? (
            <div className="portal-fallback">
              <p>Este site bloqueia embed (X-Frame-Options).</p>
              <button onClick={() => openUrl(content.currentURL).catch(() => {})}>
                Abrir no browser ⧉
              </button>
              <p className="om-muted">Estágio 2 usa WebView2 nativa por portal.</p>
            </div>
          ) : (
            <iframe
              src={content.currentURL}
              title={content.name}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              onLoad={() => setLoading(false)}
            />
          )
        ) : (
          <div className="portal-empty">Digite uma URL acima ⏎</div>
        )}
      </div>
    </div>
  );
}

export function normalizeUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(t) || /^\d+\.\d+\.\d+\.\d+/.test(t)) return `http://${t}`;
  if (/^[\w-]+(\.[\w-]+)+/.test(t)) return `https://${t}`;
  return null;
}

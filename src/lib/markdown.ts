/** Minimal markdown renderer (headings/bold/italic/code/links/lists). Escapes HTML first. */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(s: string): string {
  let e = escapeHtml(s);
  e = e.replace(/`([^`]+)`/g, "<code>$1</code>");
  e = e.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  e = e.replace(/(^|\W)\*([^*\n]+)\*/g, "$1<em>$2</em>");
  e = e.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return e;
}

export function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inFence = false;
  let fenceBuf: string[] = [];
  let listBuf: string[] = [];

  const flushList = () => {
    if (listBuf.length > 0) {
      out.push("<ul>" + listBuf.map((l) => `<li>${inline(l)}</li>`).join("") + "</ul>");
      listBuf = [];
    }
  };

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      if (inFence) {
        out.push("<pre><code>" + escapeHtml(fenceBuf.join("\n")) + "</code></pre>");
        fenceBuf = [];
        inFence = false;
      } else {
        inFence = true;
      }
      continue;
    }
    if (inFence) {
      fenceBuf.push(line);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      listBuf.push(li[1]);
      continue;
    }
    flushList();
    if (line.trim() === "") {
      out.push("");
    } else {
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  flushList();
  if (inFence) out.push("<pre><code>" + escapeHtml(fenceBuf.join("\n")) + "</code></pre>");
  return out.join("\n");
}

/** Mac format: `[N lines total]\n1    line...` with optional offset/limit. */
export function formatWithLineRange(content: string, offset?: number, limit?: number): string {
  const lines = content.split("\n");
  const total = lines.length;
  const start = Math.max(0, (offset ?? 1) - 1);
  const end = Math.min(total, start + (limit ?? total));
  const sel = lines.slice(start, end);
  const header =
    offset != null && limit != null ? `[lines ${offset}-${offset + limit - 1} of ${total}]` : `[${total} lines total]`;
  const numbered = sel.map((l, i) => `${start + i + 1}    ${l}`).join("\n");
  return `${header}\n${numbered}`;
}

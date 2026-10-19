import { describe, expect, it } from "vitest";
import { escapeHtml, formatWithLineRange, renderMarkdown } from "../src/lib/markdown";

describe("note-format", () => {
  it("escapes HTML", () => {
    expect(escapeHtml('<b>&"')).toBe("&lt;b&gt;&amp;&quot;");
  });
  it("headings", () => {
    expect(renderMarkdown("# T")).toContain("<h1>T</h1>");
    expect(renderMarkdown("### T")).toContain("<h3>T</h3>");
  });
  it("bold/italic/code/link", () => {
    const h = renderMarkdown("**b** *i* `c` [t](http://x)");
    expect(h).toContain("<strong>b</strong>");
    expect(h).toContain("<em>i</em>");
    expect(h).toContain("<code>c</code>");
    expect(h).toContain('<a href="http://x">t</a>');
  });
  it("fence + list", () => {
    const h = renderMarkdown("```\n<a>\n```\n- a\n- b");
    expect(h).toContain("<pre><code>&lt;a&gt;</code></pre>");
    expect(h).toContain("<ul><li>a</li><li>b</li></ul>");
  });
  it("does not render raw HTML", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("<script>");
  });
  it("line range format matches Mac", () => {
    expect(formatWithLineRange("a\nb\nc")).toBe("[3 lines total]\n1    a\n2    b\n3    c");
    expect(formatWithLineRange("a\nb\nc", 2, 1)).toBe("[lines 2-2 of 3]\n2    b");
  });
});

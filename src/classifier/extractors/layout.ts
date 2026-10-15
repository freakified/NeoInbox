/**
 * Layout-aware HTML → text. Reservation emails are built from tables, and
 * the table structure is the one dependable signal of what belongs together:
 * an itinerary row holds one leg's airports, times and date; a "Check-in |
 * Check-out" row holds the stay. Flattening the HTML (one cell per line)
 * throws that away and leaves extractors pairing atoms by character distance,
 * which is how a round trip's second leg ends up with the first leg's date.
 *
 * Each innermost table row becomes one Line with its cells kept apart, and
 * every line records the table it sits in, so extractors can pair within a
 * row first and within a table second before falling back to proximity.
 */

export interface Line {
  /** The line's text; table cells joined by " | ". */
  text: string;
  /** Cell texts for a table row; [text] for anything else. */
  cells: string[];
  /** Innermost enclosing <table> (0 = none); same id = same table. */
  table: number;
}

const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "CENTER", "DD", "DIV", "DL", "DT",
  "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4",
  "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION",
  "TABLE", "TBODY", "THEAD", "TFOOT", "TR", "TD", "TH", "UL", "CAPTION",
]);

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "HEAD", "TITLE", "NOSCRIPT", "TEMPLATE"]);

// nodeType, not instanceof: DOM globals differ between realms (jsdom, TB).
const isElement = (node: Node): node is Element => node.nodeType === 1;

const clean = (s: string): string => s.replace(/[\s​‌‍⁠﻿͏]+/g, " ").trim();

/** Hidden preheaders repeat (or contradict) the body; skip display:none. */
const hidden = (el: Element): boolean => {
  const style = el.getAttribute("style");
  return style !== null && /display\s*:\s*none|mso-hide\s*:\s*all/i.test(style);
};

/** True when a table row nests further rows (a layout wrapper, not data). */
const hasNestedRow = (tr: Element): boolean => tr.querySelector("tr") !== null;

export const htmlToLines = (html: string, maxChars = 60_000): Line[] => {
  if (!html.trim() || typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const lines: Line[] = [];
  const tableIds = new Map<Element, number>();
  let chars = 0;
  let buffer = "";
  let bufferTable = 0;

  const tableOf = (node: Node): number => {
    const t = (isElement(node) ? node : node.parentElement)?.closest("table");
    if (!t) return 0;
    let id = tableIds.get(t);
    if (id === undefined) tableIds.set(t, (id = tableIds.size + 1));
    return id;
  };

  const push = (cells: string[], table: number): void => {
    const kept = cells.map(clean).filter(Boolean);
    if (!kept.length) return;
    const text = kept.join(" | ");
    lines.push({ text, cells: kept, table });
    chars += text.length;
  };

  const flush = (): void => {
    if (buffer.trim()) push([buffer], bufferTable);
    buffer = "";
  };

  /** Text of an element with every tag as a space — one cell's content. */
  const inlineText = (el: Element): string => {
    let out = "";
    const walk = (node: Node): void => {
      if (node.nodeType === 3) out += node.textContent ?? "";
      else if (isElement(node)) {
        if (SKIP_TAGS.has(node.tagName) || hidden(node)) return;
        out += " ";
        node.childNodes.forEach(walk);
        out += " ";
      }
    };
    walk(el);
    return out;
  };

  const walk = (node: Node): void => {
    if (chars > maxChars) return;
    if (node.nodeType === 3) {
      if (!buffer) bufferTable = tableOf(node);
      buffer += node.textContent ?? "";
      return;
    }
    if (!isElement(node)) return;
    const tag = node.tagName;
    if (SKIP_TAGS.has(tag) || hidden(node)) return;
    if (tag === "BR") {
      flush();
      return;
    }
    if (tag === "TR" && !hasNestedRow(node)) {
      flush();
      const cells = [...node.children]
        .filter((c) => (c.tagName === "TD" || c.tagName === "TH") && !hidden(c))
        .map(inlineText);
      push(cells, tableOf(node));
      return;
    }
    const block = BLOCK_TAGS.has(tag);
    // Inline tags still separate words, as the old flattener did: mail HTML
    // abuts styled spans ("52B7D9</span><span>LOS ANGELES") far more often
    // than it splits a word across tags.
    if (block) flush();
    else buffer += " ";
    node.childNodes.forEach(walk);
    if (block) flush();
    else buffer += " ";
  };

  walk(doc.body ?? doc.documentElement);
  flush();
  return lines;
};

/** The lines as text, one per line — what the text-tier extractors scan. */
export const linesToText = (lines: readonly Line[]): string =>
  lines.map((l) => l.text).join("\n");

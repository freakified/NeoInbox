/**
 * Helpers for the composer's rich-text box. The editor is a contentEditable
 * driven by the browser's own formatting commands, so what it produces is
 * whatever markup the engine likes; these normalize it to a small allowlist
 * before it reaches Thunderbird, and flatten it for plain-text compose.
 */

/** Tags kept as-is; anything else is unwrapped to its children. */
const KEEP = new Set([
  "B", "STRONG", "I", "EM", "U", "S", "STRIKE",
  "BR", "DIV", "P", "UL", "OL", "LI", "A", "BLOCKQUOTE",
]);

/** Dropped along with everything inside them. */
const DROP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "HEAD", "TITLE"]);

const safeHref = (href: string | null): string | null =>
  href && /^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : null;

const cleanInto = (from: Node, to: Node, doc: Document): void => {
  for (const child of Array.from(from.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      to.appendChild(doc.createTextNode(child.textContent ?? ""));
      continue;
    }
    if (!(child instanceof Element) || DROP.has(child.tagName)) continue;
    if (!KEEP.has(child.tagName)) {
      cleanInto(child, to, doc);
      continue;
    }
    const el = doc.createElement(child.tagName.toLowerCase());
    if (child.tagName === "A") {
      const href = safeHref(child.getAttribute("href"));
      if (!href) {
        cleanInto(child, to, doc);
        continue;
      }
      el.setAttribute("href", href);
    }
    cleanInto(child, el, doc);
    to.appendChild(el);
  }
};

/** The editor's markup reduced to basic formatting, lists and safe links. */
export const sanitizeComposerHtml = (html: string): string => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out = doc.createElement("div");
  cleanInto(doc.body, out, doc);
  return out.innerHTML;
};

const BLOCK = new Set(["DIV", "P", "UL", "OL", "LI", "BLOCKQUOTE"]);

/**
 * The editor's content as plain text: one line per block or <br>, list items
 * bulleted or numbered, links followed by their address when it differs.
 */
export const htmlToPlainText = (html: string): string => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  let out = "";
  const newline = () => {
    if (out && !out.endsWith("\n")) out += "\n";
  };
  const walk = (node: Node, depth: number) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += (child.textContent ?? "").replace(/ /g, " ");
        continue;
      }
      if (!(child instanceof Element) || DROP.has(child.tagName)) continue;
      if (child.tagName === "BR") {
        out += "\n";
        continue;
      }
      if (child.tagName === "UL" || child.tagName === "OL") {
        newline();
        let n = 0;
        for (const li of Array.from(child.children)) {
          if (li.tagName !== "LI") continue;
          newline();
          n += 1;
          out += "  ".repeat(depth) + (child.tagName === "OL" ? `${n}. ` : "• ");
          walk(li, depth + 1);
        }
        newline();
        continue;
      }
      const block = BLOCK.has(child.tagName);
      if (block) newline();
      walk(child, depth);
      if (child.tagName === "A") {
        const href = child.getAttribute("href")?.replace(/^mailto:/i, "");
        if (href && href !== child.textContent?.trim()) out += ` <${href}>`;
      }
      if (block) newline();
    }
  };
  walk(doc.body, 0);
  return out.replace(/\n+$/, "");
};

/** True when the editor shows nothing worth keeping (text or a list). */
export const isRichTextBlank = (html: string): boolean => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return !doc.body.textContent?.trim() && !doc.body.querySelector("li");
};

export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

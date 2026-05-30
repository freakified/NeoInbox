export const extractHtmlBody = (
  part: messenger.messages.MessagePart,
): string | null => {
  if (part.contentType === "text/html") return part.body ?? null;
  for (const p of part.parts ?? []) {
    const f = extractHtmlBody(p);
    if (f) return f;
  }
  return null;
}

const CID_RE = /cid:([^"'\s>)]+)/gi;

export const scanCidRefs = (
  part: messenger.messages.MessagePart,
): Set<string> => {
  const refs = new Set<string>();
  const visit = (p: messenger.messages.MessagePart): void => {
    if (p.contentType === "text/html" && p.body) {
      let m: RegExpExecArray | null;
      CID_RE.lastIndex = 0;
      while ((m = CID_RE.exec(p.body)) !== null) {
        let token = m[1] ?? "";
        if (token.startsWith("<")) token = token.slice(1);
        if (token.endsWith(">")) token = token.slice(0, -1);
        if (token) refs.add(token.toLowerCase());
      }
    }
    for (const child of p.parts ?? []) visit(child);
  };
  visit(part);
  return refs;
}

export const extractTextBody = (
  part: messenger.messages.MessagePart,
): string | null => {
  if (part.contentType === "text/plain") {
    return renderTextWithQuoteToggle(part.body ?? "");
  }
  for (const p of part.parts ?? []) {
    const f = extractTextBody(p);
    if (f) return f;
  }
  return null;
}

export const extractPreviewText = (
  part: messenger.messages.MessagePart,
): string => {
  const textPart = findPart(part, "text/plain");
  const htmlPart = textPart ? null : findPart(part, "text/html");
  const raw = textPart?.body ?? htmlToText(htmlPart?.body ?? "");
  return raw.replace(/\s+/g, " ").trim();
}

const findPart = (
  part: messenger.messages.MessagePart,
  contentType: string,
): messenger.messages.MessagePart | null => {
  if (part.contentType === contentType) return part;
  for (const p of part.parts ?? []) {
    const found = findPart(p, contentType);
    if (found) return found;
  }
  return null;
}

const htmlToText = (html: string): string => {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
  return doc.body.textContent ?? "";
}

const QUOTE_HEADER_RE =
  /^(On\s[\s\S]{1,240}?\swrote:|Le\s[\s\S]{1,240}?\sa\s+écrit\s*:|Am\s[\s\S]{1,240}?\sschrieb\s|-{2,}\s*Original Message\s*-{2,}|From:\s)/i;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const isWhitespaceText = (n: Node): boolean =>
  n.nodeType === Node.TEXT_NODE && !(n.textContent ?? "").trim();

const isEmptyElement = (n: Node): boolean => {
  if (!(n instanceof Element)) return false;
  if (n.tagName === "BR") return true;
  return !n.textContent?.trim() && !n.querySelector("img");
};

const isInsignificant = (n: Node): boolean =>
  isWhitespaceText(n) || isEmptyElement(n);

const isQuoteContainer = (el: Element): boolean => {
  if (el.tagName === "BLOCKQUOTE") return true;
  const cls = typeof el.className === "string" ? el.className : "";
  if (
    /\b(gmail_quote|gmail_extra|gmail_quote_container|yahoo_quoted|moz-cite-prefix)\b/.test(
      cls,
    )
  ) {
    return true;
  }
  if (el.id === "appendonsend" || el.id === "divRplyFwdMsg") return true;
  return false;
};

const findContentRoot = (body: Element): Element => {
  let root = body;
  while (
    root.children.length === 1 &&
    root.firstElementChild!.tagName === "DIV" &&
    !isQuoteContainer(root.firstElementChild!)
  ) {
    root = root.firstElementChild!;
  }
  return root;
};

const markQuotedHtml = (doc: Document): void => {
  const body = doc.body;
  if (!body) return;
  const root = findContentRoot(body);
  const children = Array.from(root.childNodes);

  let lastIdx = children.length - 1;
  while (lastIdx >= 0 && isInsignificant(children[lastIdx]!)) lastIdx--;
  if (lastIdx < 0) return;

  const last = children[lastIdx]!;
  if (!(last instanceof Element) || !isQuoteContainer(last)) return;

  let trimStart = lastIdx;
  for (let i = lastIdx - 1; i >= 0; i--) {
    const node = children[i]!;
    if (isInsignificant(node)) continue;
    if (node instanceof Element) {
      const text = (node.textContent ?? "").trim();
      if (text && text.length < 300 && QUOTE_HEADER_RE.test(text)) {
        trimStart = i;
      }
    }
    break;
  }

  const toHide: Element[] = [];
  for (let i = trimStart; i < children.length; i++) {
    const node = children[i]!;
    if (node instanceof Element) {
      node.classList.add("nb-quoted");
      toHide.push(node);
    }
  }
  const first = toHide[0];
  if (!first) return;
  const parent = first.parentElement;
  if (!parent) return;

  const id = `nb-q-${Math.random().toString(36).slice(2, 8)}`;
  const checkbox = doc.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "nb-toggle-checkbox";
  checkbox.id = id;
  const label = doc.createElement("label");
  label.className = "nb-toggle-label";
  label.htmlFor = id;
  label.title = "Show trimmed content";
  label.appendChild(doc.createTextNode("···"));

  parent.insertBefore(checkbox, first);
  parent.insertBefore(label, first);
};

const renderTextWithQuoteToggle = (raw: string): string => {
  const preStyle = "white-space:pre-wrap;font-family:inherit;margin:0";
  const wrap = (s: string, cls = "") =>
    `<pre${cls ? ` class="${cls}"` : ""} style="${preStyle}">${escapeHtml(s)}</pre>`;

  const lines = raw.split("\n");
  const isQuoted = (line: string) => /^\s*>/.test(line);

  let i = lines.length - 1;
  while (i >= 0 && (lines[i] ?? "").trim() === "") i--;
  const contentEnd = i;

  while (i >= 0) {
    const line = lines[i] ?? "";
    if (!isQuoted(line) && line.trim() !== "") break;
    i--;
  }
  let trimStart = i + 1;

  const quotedLineCount = lines
    .slice(trimStart, contentEnd + 1)
    .filter(isQuoted).length;
  if (quotedLineCount < 2) return wrap(raw);

  while (i >= 0 && (lines[i] ?? "").trim() === "") i--;
  if (i >= 0) {
    const candidate = (lines[i] ?? "").trim();
    if (candidate.length < 300 && QUOTE_HEADER_RE.test(candidate)) {
      trimStart = i;
    }
  }

  const before = lines.slice(0, trimStart).join("\n").replace(/\s+$/, "");
  const after = lines.slice(trimStart).join("\n");

  const id = `nb-q-${Math.random().toString(36).slice(2, 8)}`;
  return (
    wrap(before) +
    `<input type="checkbox" class="nb-toggle-checkbox" id="${id}">` +
    `<label class="nb-toggle-label" for="${id}" title="Show trimmed content">···</label>` +
    wrap(after, "nb-quoted")
  );
};

const BASE_CSS = `<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       font-size:14px;margin:0!important;padding:8px!important;
       box-sizing:border-box;color:#111;word-break:break-word}
  img{max-width:100%;height:auto}a{color:#1a73e8}
  blockquote{border-left:3px solid #ddd;margin:0 0 0 8px;padding-left:8px;color:#555}
  table{border-collapse:collapse}
  .nb-toggle-checkbox{position:absolute;opacity:0;pointer-events:none}
  .nb-toggle-label{display:inline-block;padding:0 8px;margin:6px 0;
    background:#f1f3f4;border-radius:4px;cursor:pointer;color:#5f6368;
    font-size:14px;line-height:22px;letter-spacing:1px;user-select:none}
  .nb-toggle-label:hover{background:#e8eaed}
  .nb-toggle-checkbox:not(:checked) ~ .nb-quoted{display:none}
  .nb-toggle-checkbox:checked ~ .nb-toggle-label{display:none}
  .nb-blocked-image{display:none!important}
</style>`;

const isRemoteUrl = (value: string | null): boolean => {
  const url = value?.trim();
  if (!url) return false;
  const lower = url.toLowerCase();
  return !lower.startsWith("data:") && !lower.startsWith("cid:");
};

const hasRemoteBackground = (backgroundImage: string): boolean => {
  if (!backgroundImage || backgroundImage === "none") return false;
  return /url\(\s*(?!['"]?(?:data|cid):)/i.test(backgroundImage);
};

const blockRemoteImages = (doc: Document): void => {
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src");
    const srcset = img.getAttribute("srcset");
    if (isRemoteUrl(src) || isRemoteUrl(srcset)) {
      img.dataset.src = src ?? "";
      img.dataset.srcset = srcset ?? "";
      img.removeAttribute("src");
      img.removeAttribute("srcset");
      img.classList.add("nb-blocked-image");
    }
  });

  doc.querySelectorAll("source").forEach((source) => {
    const srcset = source.getAttribute("srcset");
    if (isRemoteUrl(srcset)) {
      source.dataset.srcset = srcset ?? "";
      source.removeAttribute("srcset");
    }
  });

  doc.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    const backgroundImage = el.style.backgroundImage;
    if (hasRemoteBackground(backgroundImage)) {
      el.dataset.bgimg = backgroundImage;
      el.style.backgroundImage = "none";
    }
  });
};

export const hasBlockedRemoteImages = (rawHtml: string): boolean => {
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  if (
    Array.from(doc.querySelectorAll("img")).some(
      (img) => isRemoteUrl(img.getAttribute("src")) || isRemoteUrl(img.getAttribute("srcset")),
    )
  ) {
    return true;
  }
  if (
    Array.from(doc.querySelectorAll("source")).some((source) =>
      isRemoteUrl(source.getAttribute("srcset")),
    )
  ) {
    return true;
  }
  return Array.from(doc.querySelectorAll<HTMLElement>("[style]")).some((el) =>
    hasRemoteBackground(el.style.backgroundImage),
  );
};

export const buildSrcdoc = (rawHtml: string, showImages: boolean): string => {
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  doc.querySelectorAll("script, noscript").forEach((el) => el.remove());
  if (!showImages) blockRemoteImages(doc);
  markQuotedHtml(doc);
  doc.head.insertAdjacentHTML("afterbegin", BASE_CSS);
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
}

export const buildTextSrcdoc = (rawText: string): string =>
  `<!DOCTYPE html><html><head>${BASE_CSS}</head><body>${renderTextWithQuoteToggle(rawText)}</body></html>`;

export const extractRawTextBody = (
  part: messenger.messages.MessagePart,
): string | null => {
  if (part.contentType === "text/plain") return part.body ?? "";
  for (const p of part.parts ?? []) {
    const found = extractRawTextBody(p);
    if (found !== null) return found;
  }
  const html = extractHtmlBody(part);
  return html ? htmlToText(html) : null;
};

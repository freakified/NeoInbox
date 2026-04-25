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

export const extractTextBody = (
  part: messenger.messages.MessagePart,
): string | null => {
  if (part.contentType === "text/plain") {
    const esc = (part.body ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${esc}</pre>`;
  }
  for (const p of part.parts ?? []) {
    const f = extractTextBody(p);
    if (f) return f;
  }
  return null;
}

const BASE_CSS = `<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       font-size:14px;margin:0;padding:8px;color:#111;word-break:break-word}
  img{max-width:100%;height:auto}a{color:#1a73e8}
  blockquote{border-left:3px solid #ddd;margin:0 0 0 8px;padding-left:8px;color:#555}
  table{border-collapse:collapse}
</style>`;

export const buildSrcdoc = (rawHtml: string, showImages: boolean): string => {
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  doc.querySelectorAll("script, noscript").forEach((el) => el.remove());
  if (!showImages) {
    doc.querySelectorAll("img").forEach((img) => {
      if (img.src && !img.src.startsWith("data:")) {
        img.dataset.src = img.src;
        img.removeAttribute("src");
        img.removeAttribute("srcset");
      }
    });
    doc.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
      const s = el.style.backgroundImage;
      if (s && s !== "none") {
        el.dataset.bgimg = s;
        el.style.backgroundImage = "none";
      }
    });
  }
  doc.head.insertAdjacentHTML("afterbegin", BASE_CSS);
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
}

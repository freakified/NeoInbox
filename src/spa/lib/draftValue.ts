/**
 * A draft saved in Thunderbird, read back as inline-composer content: only
 * the part the user wrote, without the quote, forward, or signature that
 * Thunderbird keeps (and puts back on send, see replaceDraftHtmlBody).
 */
import { splitDraftHtml, splitDraftPlain } from "../../shared/compose";
import { liveTbId } from "../../shared/liveMessage";
import { log } from "../../shared/log";
import type { RawMessage } from "../../shared/types";
import type { ComposerValue } from "../components/ComposerForm";
import { escapeHtml, htmlToPlainText, sanitizeComposerHtml } from "./richText";
import { extractHtmlBody } from "./srcdoc";

const findPlain = (part: messenger.messages.MessagePart): string | null => {
  if (part.contentType === "text/plain") return part.body ?? "";
  for (const p of part.parts ?? []) {
    const found = findPlain(p);
    if (found !== null) return found;
  }
  return null;
};

const isBlankNode = (node: Node): boolean =>
  node.nodeType === Node.TEXT_NODE
    ? !node.textContent?.trim()
    : node instanceof Element &&
      (node.tagName === "BR" ||
        (!node.textContent?.trim() && !node.querySelector("li") && node.tagName !== "LI"));

/** Sanitized, without the blank lines Thunderbird leaves around the user's text. */
export const draftEditorHtml = (userHtml: string): string => {
  const clean = sanitizeComposerHtml(userHtml);
  const box = new DOMParser().parseFromString(`<body>${clean}</body>`, "text/html").body;
  while (box.firstChild && isBlankNode(box.firstChild)) box.firstChild.remove();
  while (box.lastChild && isBlankNode(box.lastChild)) box.lastChild.remove();
  return box.innerHTML;
};

export const plainToEditorHtml = (text: string): string =>
  text
    ? text
        .split("\n")
        .map((line) => `<div>${escapeHtml(line) || "<br>"}</div>`)
        .join("")
    : "";

/** The editable body of a draft, from its HTML part or else its plain text. */
export const draftBody = (
  html: string | null,
  plain: string | null,
): { html: string; text: string } => {
  if (html !== null) {
    const editor = draftEditorHtml(splitDraftHtml(html).user);
    return { html: editor, text: htmlToPlainText(editor) };
  }
  const text = splitDraftPlain((plain ?? "").replace(/\r\n/g, "\n")).user.replace(/^\n+/, "");
  return { html: plainToEditorHtml(text), text };
};

const loaded = new Map<string, Promise<ComposerValue | null>>();

const load = async (m: RawMessage): Promise<ComposerValue | null> => {
  const liveId = await liveTbId(m);
  if (liveId === null) return null;
  const full = await messenger.messages.getFull(liveId);
  return {
    // Thunderbird records the draft's identity under its key, which is the
    // same id the identities API hands out.
    identityId: full.headers?.["x-identity-key"]?.[0],
    to: [...m.recipients],
    cc: [...m.ccList],
    subject: m.subject,
    ...draftBody(extractHtmlBody(full), findPlain(full)),
  };
};

/** Null when the draft is gone or unreadable. Cached per draft. */
export const loadDraftValue = (m: RawMessage): Promise<ComposerValue | null> => {
  let pending = loaded.get(m.key);
  if (!pending) {
    pending = load(m).catch((e) => {
      log.warn("compose", "couldn't read draft", e);
      loaded.delete(m.key);
      return null;
    });
    loaded.set(m.key, pending);
  }
  return pending;
};

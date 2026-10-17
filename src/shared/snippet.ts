import { htmlToText } from "../classifier/extractors/text";

type Part = messenger.messages.MessagePart;

/** Long enough to fill the widest row; the row ellipsizes the rest. */
export const SNIPPET_CHARS = 200;

const isAttachment = (part: Part): boolean => {
  const disposition = (part.headers?.["content-disposition"] ?? []).join(" ").toLowerCase();
  return disposition.startsWith("attachment") || !!part.name;
};

/** The first inline text/plain and text/html bodies, depth-first. */
const findBodies = (part: Part, found: { text?: string; html?: string }): void => {
  if (part.body && !isAttachment(part)) {
    const ct = (part.contentType ?? "").toLowerCase();
    if (ct.startsWith("text/plain")) found.text ??= part.body;
    else if (ct.startsWith("text/html")) found.html ??= part.body;
  }
  for (const sub of part.parts ?? []) findBodies(sub, found);
};

/**
 * Where the new text of a reply ends: the attribution line before a quote
 * ("On Tue, Ada wrote:"), Outlook's "-----Original Message-----" or the
 * underscore rule it puts above a reply's headers, or a signature delimiter.
 */
const QUOTE_START_RE =
  /^(On\b.{0,200}\bwrote:|-{2,}\s*Original Message\s*-{2,}|-- ?$|_{10,}$)/im;

/**
 * The grey text after a subject in the list, as Google Inbox showed it: the
 * opening of the message's own words, with quoted history and signatures cut.
 * Plain text is preferred; an HTML-only message is flattened, with its
 * blockquotes (quoted replies) dropped first.
 */
export const snippetFromPart = (full: Part | null | undefined): string => {
  if (!full) return "";
  const found: { text?: string; html?: string } = {};
  findBodies(full, found);
  let text = found.text;
  if (text === undefined && found.html !== undefined) {
    text = htmlToText(found.html.replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, " "));
  }
  if (!text) return "";

  const own = text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");
  const cut = own.search(QUOTE_START_RE);
  return (cut >= 0 ? own.slice(0, cut) : own)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SNIPPET_CHARS);
};

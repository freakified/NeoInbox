/**
 * Inline compose: what the SPA's composer hands the background, and the pure
 * helpers both halves share.
 *
 * There is no headless send in the MailExtension API, so the background opens
 * a real Thunderbird compose window, fills it from a ComposeDraft, and either
 * sends it (the window shows briefly, then closes) or leaves it open for the
 * user to finish. Thunderbird keeps owning identities, signatures, quoting,
 * encryption, the Sent copy, and the outbox.
 */
import { parseSender } from "./senders";

export type ComposeKind = "reply" | "replyAll" | "forward" | "new";

export interface ComposeDraft {
  kind: ComposeKind;
  /** The message being replied to or forwarded; absent for new mail. */
  messageId?: number;
  /** Send-from identity; Thunderbird picks one when absent. */
  identityId?: string;
  to: string[];
  cc: string[];
  /** Only used for new mail; replies and forwards keep Thunderbird's subject. */
  subject?: string;
  /** What the user typed, as plain text (for plain-text compose). */
  text: string;
  /**
   * The same message with its formatting, as sanitized HTML (for HTML
   * compose). Absent means build it from `text`.
   */
  html?: string;
}

/**
 * Splits an address header ("A <a@x>, \"Last, First\" <b@y>") into single
 * addresses, respecting quoted display names and angle brackets.
 */
export const splitAddressList = (value: string): string[] => {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  let angled = false;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "<" && !quoted) angled = true;
    else if (ch === ">" && !quoted) angled = false;
    if ((ch === "," || ch === ";") && !quoted && !angled) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
};

export const addressEmail = (raw: string): string => parseSender(raw).email;

/** Drops addresses that are the user's own, and repeats, keeping first-seen form. */
const filterAddresses = (
  addresses: string[],
  exclude: ReadonlySet<string>,
): string[] => {
  const seen = new Set(exclude);
  const out: string[] = [];
  for (const raw of addresses) {
    const email = addressEmail(raw);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(raw);
  }
  return out;
};

export interface ReplySource {
  author: string;
  recipients: string[];
  ccList: string[];
  /** The Reply-To header's value, when the message has one. */
  replyTo?: string;
}

/**
 * Who a reply goes to, worked out the way Thunderbird does it: Reply-To over
 * From, everyone else on To/Cc for reply-all, never yourself. Replying to your
 * own message goes to its original recipients instead.
 */
export const replyRecipients = (
  source: ReplySource,
  kind: "reply" | "replyAll",
  myEmails: ReadonlySet<string>,
): { to: string[]; cc: string[] } => {
  const fromMe = myEmails.has(addressEmail(source.author));
  const primary = fromMe
    ? source.recipients
    : source.replyTo
      ? splitAddressList(source.replyTo)
      : [source.author];
  if (kind === "reply") {
    const to = filterAddresses(primary, myEmails);
    return { to: to.length ? to : primary.slice(0, 1), cc: [] };
  }
  const toCandidates = fromMe ? primary : [...primary, ...source.recipients];
  const to = filterAddresses(toCandidates, myEmails);
  const cc = filterAddresses(
    source.ccList,
    new Set([...myEmails, ...to.map(addressEmail)]),
  );
  return { to: to.length ? to : primary.slice(0, 1), cc };
};

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The user's plain text as compose-editor HTML: one line per <br>. */
export const textToHtml = (text: string): string =>
  `<div>${escapeHtml(text.trimEnd()).replace(/\r?\n/g, "<br>")}</div><br>`;

/**
 * Puts the user's text at the top of the body Thunderbird generated, so the
 * quote, the signature, and the identity's formatting all survive.
 */
export const prependToHtmlBody = (body: string, html: string): string => {
  const open = body.match(/<body[^>]*>/i);
  if (!open || open.index === undefined) return html + body;
  const at = open.index + open[0].length;
  return body.slice(0, at) + html + body.slice(at);
};

export const prependToPlainBody = (body: string, text: string): string =>
  `${text.trimEnd()}\n\n${body.replace(/^\n+/, "")}`;

export interface ComposeIdentity {
  id: string;
  accountId: string;
  email: string;
  name: string;
}

/** "Name <email>", or the bare address when the identity has no name. */
export const identityLabel = (identity: ComposeIdentity): string =>
  identity.name ? `${identity.name} <${identity.email}>` : identity.email;

/**
 * The identity to send from by default, the way Thunderbird chooses: one the
 * original message was addressed to (or sent from, for your own mail), else
 * the default identity of the message's account, else the default overall.
 * `identities` must list the default account first, each account's default
 * identity first within it.
 */
export const pickIdentity = (
  identities: readonly ComposeIdentity[],
  context: { accountId?: string; addresses?: readonly string[] } = {},
): ComposeIdentity | undefined => {
  const addressed = new Set((context.addresses ?? []).map(addressEmail));
  return (
    identities.find((i) => addressed.has(i.email.toLowerCase())) ??
    identities.find((i) => i.accountId === context.accountId) ??
    identities[0]
  );
};

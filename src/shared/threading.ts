import type { MessageOrigin, RawMessage, Thread } from "./types";

export function normalizeSubject(subject: string): string {
  let s = subject.trim();
  for (let i = 0; i < 8; i++) {
    const stripped = s.replace(/^\s*(re|fwd?)\s*:\s*/i, "");
    if (stripped === s) break;
    s = stripped;
  }
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function extractEmail(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return (m?.[1] ?? addr).trim().toLowerCase();
}

function displayName(addr: string): string {
  const m = addr.match(/^"?([^"<]+)"?\s*</);
  const name = m?.[1]?.trim() ?? addr.replace(/<[^>]+>/g, "").trim();
  return name || addr;
}

const cleanMessageId = (id: string | undefined): string => {
  return (id ?? "").replace(/[<>]/g, "").trim().toLowerCase();
}

const participantEmails = (
  msg: RawMessage,
  myEmails: ReadonlySet<string>,
): Set<string> => {
  const emails = [msg.author, ...msg.recipients]
    .map(extractEmail)
    .filter((email) => email && !myEmails.has(email));
  return new Set(emails);
}

const subjectParticipantKey = (
  accountId: string,
  subject: string,
  email: string,
): string => {
  return `${accountId}\0subject\0${subject}\0participant\0${email}`;
}

type FallbackAnchor = {
  node: string;
  date: number;
};

class DisjointSet {
  private parents = new Map<string, string>();

  add(value: string): void {
    if (!this.parents.has(value)) this.parents.set(value, value);
  }

  find(value: string): string {
    this.add(value);
    const parent = this.parents.get(value);
    if (!parent || parent === value) return value;
    const root = this.find(parent);
    this.parents.set(value, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parents.set(rootB, rootA);
  }
}

function makeParticipantsLabel(
  msgs: RawMessage[],
  myEmails: ReadonlySet<string>,
): string {
  const others: string[] = [];
  const seen = new Set<string>();
  let meSeen = false;
  for (const m of msgs) {
    const email = extractEmail(m.author);
    if (myEmails.has(email)) { meSeen = true; continue; }
    if (seen.has(email)) continue;
    seen.add(email);
    others.push(displayName(m.author));
  }
  const parts: string[] = [];
  if (others.length <= 3) {
    parts.push(...others);
  } else if (others[0] && others[1]) {
    parts.push(others[0], others[1], `+${others.length - 2}`);
  }
  if (meSeen) parts.push("me");
  if (parts.length === 0) return "(unknown)";
  const label = parts.join(", ");
  return msgs.length > 1 ? `${label} (${msgs.length})` : label;
}

function threadCategory(msgs: RawMessage[]): RawMessage["category"] {
  return msgs.find((m) => (m.origin === "inbox" || m.origin === "done") && m.category)?.category ?? null;
}

const messageSortDate = (msg: RawMessage): number =>
  msg.origin === "inbox" ? msg.resurfacedAt ?? msg.date : msg.date;

const stableThreadId = (
  msgs: readonly RawMessage[],
  messageNodes: ReadonlyMap<number, string>,
  anchorOrigins: ReadonlySet<MessageOrigin>,
): string => {
  const anchors = msgs.filter((m) => anchorOrigins.has(m.origin));
  const candidates = anchors.length ? anchors : msgs;
  const [first] = [...candidates].sort((a, b) => a.date - b.date || a.id - b.id);
  return first ? messageNodes.get(first.id) ?? String(first.id) : "";
}

export function buildThreads(
  messages: readonly RawMessage[],
  myEmails: ReadonlySet<string>,
  anchorOrigins: ReadonlySet<MessageOrigin> = new Set(["inbox"]),
): Thread[] {
  const separator = "\0";
  const ids = new DisjointSet();
  const messageNodes = new Map<number, string>();
  const anchorNodesBySubjectParticipant = new Map<string, FallbackAnchor[]>();

  for (const m of messages) {
    const selfId = cleanMessageId(m.headerMessageId);
    const selfNode = selfId
      ? `${m.accountId}${separator}msg${separator}${selfId}`
      : `${m.accountId}${separator}local${separator}${m.id}`;
    messageNodes.set(m.id, selfNode);
    ids.add(selfNode);

    const relatedIds = [...(m.references ?? []), ...(m.inReplyTo ?? [])]
      .map(cleanMessageId)
      .filter(Boolean);
    for (const relatedId of relatedIds) {
      ids.union(selfNode, `${m.accountId}${separator}msg${separator}${relatedId}`);
    }

    if (anchorOrigins.has(m.origin)) {
      const subject = normalizeSubject(m.subject);
      if (!subject) continue;
      for (const email of participantEmails(m, myEmails)) {
        const key = subjectParticipantKey(m.accountId, subject, email);
        const anchors = anchorNodesBySubjectParticipant.get(key) ?? [];
        anchors.push({ node: selfNode, date: m.date });
        anchorNodesBySubjectParticipant.set(key, anchors);
      }
    }
  }

  for (const m of messages) {
    if (anchorOrigins.has(m.origin)) continue;
    if (m.origin !== "sent") continue;
    const subject = normalizeSubject(m.subject);
    if (!subject) continue;
    const selfNode = messageNodes.get(m.id);
    if (!selfNode) continue;
    const candidates = new Map<string, FallbackAnchor>();
    for (const email of participantEmails(m, myEmails)) {
      const key = subjectParticipantKey(m.accountId, subject, email);
      const anchors = anchorNodesBySubjectParticipant.get(key);
      if (!anchors) continue;
      for (const anchor of anchors) candidates.set(anchor.node, anchor);
    }
    const best = [...candidates.values()].sort((a, b) => {
      const aAfter = a.date > m.date;
      const bAfter = b.date > m.date;
      if (aAfter !== bAfter) return aAfter ? 1 : -1;
      return Math.abs(a.date - m.date) - Math.abs(b.date - m.date);
    })[0];
    if (best) {
      ids.union(selfNode, best.node);
    }
  }

  const byKey = new Map<string, RawMessage[]>();
  for (const m of messages) {
    const node = messageNodes.get(m.id) ?? `${m.accountId}${separator}local${separator}${m.id}`;
    const key = ids.find(node);
    const arr = byKey.get(key) ?? [];
    arr.push(m);
    byKey.set(key, arr);
  }

  const threads: Thread[] = [];
  for (const [key, msgs] of byKey) {
    if (!msgs.some((m) => anchorOrigins.has(m.origin))) continue;
    msgs.sort((a, b) => a.date - b.date);
    const latest = msgs[msgs.length - 1];
    if (!latest) continue;
    const latestDate = msgs.reduce((max, msg) => Math.max(max, messageSortDate(msg)), 0);
    threads.push({
      id: stableThreadId(msgs, messageNodes, anchorOrigins) || key,
      subject: latest.subject || "(no subject)",
      messages: msgs,
      participantsLabel: makeParticipantsLabel(msgs, myEmails),
      latestDate,
      unreadCount: msgs.filter((m) => !m.read && anchorOrigins.has(m.origin)).length,
      pinned: msgs.some((m) => m.pinned),
      category: threadCategory(msgs),
      accountId: latest.accountId,
      hasMe: msgs.some((m) => myEmails.has(extractEmail(m.author))),
    });
  }

  threads.sort((a, b) => b.latestDate - a.latestDate);
  return threads;
}

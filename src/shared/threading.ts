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

export function buildThreads(
  messages: readonly RawMessage[],
  myEmails: ReadonlySet<string>,
  anchorOrigins: ReadonlySet<MessageOrigin> = new Set(["inbox"]),
): Thread[] {
  const separator = "\0";
  const ids = new DisjointSet();
  const messageNodes = new Map<number, string>();

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
    threads.push({
      id: key,
      subject: latest.subject || "(no subject)",
      messages: msgs,
      participantsLabel: makeParticipantsLabel(msgs, myEmails),
      latestDate: latest.date,
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

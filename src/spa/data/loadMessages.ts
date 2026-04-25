import type { RawMessage, Thread } from "../../shared/types";
import { categoryFromTags, PINNED_KEY } from "../../shared/categories";
import {
  collectInboxFolders,
  collectSentFolders,
  type InboxFolder,
} from "../../shared/folders";
import { db } from "../../store/db";
import type { Request } from "../../shared/messaging";

const HARD_LIMIT = 500;

export interface InboxLoad {
  messages: RawMessage[];
  myEmails: Set<string>;
}

export async function loadInbox(): Promise<InboxLoad> {
  const [inboxFolders, sentFolders, myEmails] = await Promise.all([
    collectInboxFolders(),
    collectSentFolders(),
    loadMyEmails(),
  ]);

  const [inboxMsgs, sentMsgs] = await Promise.all([
    loadFromFolders(inboxFolders, "inbox"),
    loadFromFolders(sentFolders, "sent"),
  ]);

  const snoozedIds = new Set(
    (await db.snoozes.toArray()).map((s) => s.messageId),
  );

  const messages = [...inboxMsgs, ...sentMsgs].filter((m) => !snoozedIds.has(m.id));
  return { messages, myEmails };
}

export async function triggerBackfill(): Promise<void> {
  await send({ type: "backfill" });
}

export async function sendPin(messageId: number, pinned: boolean): Promise<void> {
  await send({ type: "pin", messageId, pinned });
}

export async function sendDone(messageId: number, accountId: string): Promise<void> {
  await send({ type: "done", messageId, accountId });
}

export async function sendSnooze(messageId: number, wakeAt: number): Promise<void> {
  await send({ type: "snooze", messageId, wakeAt });
}

export async function sendTrash(messageId: number): Promise<void> {
  await send({ type: "trash", messageId });
}

function send(req: Request): Promise<unknown> {
  return messenger.runtime.sendMessage(req);
}

// ─── folder → RawMessage[] ─────────────────────────────────────────────────

async function loadFromFolders(
  folders: InboxFolder[],
  origin: "inbox" | "sent",
): Promise<RawMessage[]> {
  const out: RawMessage[] = [];
  for (const folder of folders) {
    let page = await messenger.messages.list(folder.id);
    absorb(out, page.messages, origin);
    while (page.id && out.length < HARD_LIMIT) {
      page = await messenger.messages.continueList(page.id);
      absorb(out, page.messages, origin);
    }
    if (out.length >= HARD_LIMIT) break;
  }
  out.sort((a, b) => b.date - a.date);
  return out.slice(0, HARD_LIMIT);
}

function absorb(
  out: RawMessage[],
  msgs: messenger.messages.MessageHeader[],
  origin: "inbox" | "sent",
): void {
  for (const m of msgs) {
    const tags = m.tags ?? [];
    const folder = (
      m as unknown as { folder?: { id?: string; accountId?: string } }
    ).folder;
    out.push({
      id: m.id,
      subject: m.subject ?? "",
      author: m.author ?? "",
      recipients: m.recipients ?? [],
      date: m.date ? new Date(m.date).getTime() : 0,
      read: m.read ?? false,
      folderId: folder?.id ?? "",
      accountId: folder?.accountId ?? "",
      tags,
      category: categoryFromTags(tags),
      pinned: tags.includes(PINNED_KEY),
      origin,
    });
  }
}

// ─── my-identity emails ───────────────────────────────────────────────────

async function loadMyEmails(): Promise<Set<string>> {
  const accounts = await messenger.accounts.list();
  const out = new Set<string>();
  for (const acc of accounts) {
    const identities = (acc as unknown as {
      identities?: { email?: string }[];
    }).identities ?? [];
    for (const id of identities) {
      if (id.email) out.add(id.email.toLowerCase());
    }
  }
  return out;
}

// ─── threading ─────────────────────────────────────────────────────────────

// Strip repeated "Re:" / "Fwd:" / "Fw:" prefixes and normalize whitespace.
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
  return (m ? m[1] : addr).trim().toLowerCase();
}

function displayName(addr: string): string {
  const m = addr.match(/^"?([^"<]+)"?\s*</);
  const name = m ? m[1].trim() : addr.replace(/<[^>]+>/g, "").trim();
  return name || addr;
}

function firstName(name: string): string {
  const bare = name.replace(/@.*$/, "");
  const first = bare.split(/[\s,]+/)[0] ?? bare;
  return first || name;
}

export function buildThreads(messages: RawMessage[], myEmails: Set<string>): Thread[] {
  const byKey = new Map<string, RawMessage[]>();
  for (const m of messages) {
    const key = `${m.accountId}\u0000${normalizeSubject(m.subject) || `__id_${m.id}`}`;
    const arr = byKey.get(key) ?? [];
    arr.push(m);
    byKey.set(key, arr);
  }

  const threads: Thread[] = [];
  for (const [key, msgs] of byKey) {
    if (!msgs.some((m) => m.origin === "inbox")) continue; // drop sent-only
    msgs.sort((a, b) => a.date - b.date);
    const latest = msgs[msgs.length - 1];
    const participantsLabel = makeParticipantsLabel(msgs, myEmails);
    const hasMe = msgs.some((m) => myEmails.has(extractEmail(m.author)));
    threads.push({
      id: key,
      subject: latest.subject || "(no subject)",
      messages: msgs,
      participantsLabel,
      latestDate: latest.date,
      unreadCount: msgs.filter((m) => !m.read && m.origin === "inbox").length,
      pinned: msgs.some((m) => m.pinned),
      category: latest.category,
      accountId: latest.accountId,
      hasMe,
    });
  }

  threads.sort((a, b) => b.latestDate - a.latestDate);
  return threads;
}

function makeParticipantsLabel(
  msgs: RawMessage[],
  myEmails: Set<string>,
): string {
  const others: string[] = [];
  const seen = new Set<string>();
  let meSeen = false;
  for (const m of msgs) {
    const email = extractEmail(m.author);
    if (myEmails.has(email)) { meSeen = true; continue; }
    if (seen.has(email)) continue;
    seen.add(email);
    others.push(firstName(displayName(m.author)));
  }
  const parts: string[] = [];
  if (others.length <= 3) parts.push(...others);
  else parts.push(others[0], others[1], `+${others.length - 2}`);
  if (meSeen) parts.push("me");
  if (parts.length === 0) return "(unknown)";
  const label = parts.join(", ");
  return msgs.length > 1 ? `${label} (${msgs.length})` : label;
}

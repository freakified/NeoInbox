import type { RawMessage } from "../../shared/types";
import { categoryFromTags, PINNED_KEY } from "../../shared/categories";
import { collectInboxFolders } from "../../shared/folders";
import { db } from "../../store/db";
import type { Request } from "../../shared/messaging";

const HARD_LIMIT = 500;

export async function loadInboxMessages(): Promise<RawMessage[]> {
  const inboxes = await collectInboxFolders();

  const results: RawMessage[] = [];
  for (const folder of inboxes) {
    let page = await messenger.messages.list(folder.id);
    absorb(results, page.messages);
    while (page.id && results.length < HARD_LIMIT) {
      page = await messenger.messages.continueList(page.id);
      absorb(results, page.messages);
    }
    if (results.length >= HARD_LIMIT) break;
  }

  const snoozedIds = new Set(
    (await db.snoozes.toArray()).map((s) => s.messageId),
  );

  results.sort((a, b) => b.date - a.date);
  return results
    .slice(0, HARD_LIMIT)
    .filter((m) => !snoozedIds.has(m.id));
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

function send(req: Request): Promise<unknown> {
  return messenger.runtime.sendMessage(req);
}

function absorb(
  out: RawMessage[],
  msgs: messenger.messages.MessageHeader[],
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
      date: m.date ? new Date(m.date).getTime() : 0,
      read: m.read ?? false,
      folderId: folder?.id ?? "",
      accountId: folder?.accountId ?? "",
      tags,
      category: categoryFromTags(tags),
      pinned: tags.includes(PINNED_KEY),
    });
  }
}

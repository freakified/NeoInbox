import { classifyAndTag } from "./ingest";
import { headerToRawMessage } from "./messageMap";
import { broadcast } from "./port";
import { db } from "../store/db";
import { categoryFromTags } from "../shared/categories";
import { collectInboxFolders, collectSentFolders } from "../shared/folders";
import type { RawMessage } from "../shared/types";
import { ensureTagsRegistered } from "./tags";

const PROGRESS_EVERY = 50;
const BATCH_FLUSH = 100;

let running = false;

export const runBackfill = async (): Promise<{
  scanned: number;
  tagged: number;
}> => {
  if (running) return { scanned: 0, tagged: 0 };
  running = true;
  try {
    await ensureTagsRegistered();
    const [inboxes, sents] = await Promise.all([
      collectInboxFolders(),
      collectSentFolders(),
    ]);

    let scanned = 0;
    let tagged = 0;
    let batch: RawMessage[] = [];

    const flush = async () => {
      if (!batch.length) return;
      await db.messages.bulkPut(batch);
      broadcast({ type: "delta", added: batch });
      batch = [];
    };

    const visit = async (
      folder: { id: string },
      origin: "inbox" | "sent",
    ) => {
      let page = await messenger.messages.list(
        folder.id as unknown as messenger.folders.MailFolderId,
      );
      while (true) {
        for (const header of page.messages) {
          scanned++;
          const before = categoryFromTags(header.tags);
          let appliedCategory = before;
          if (origin === "inbox" && !before) {
            const cat = await classifyAndTag(header);
            if (cat) {
              tagged++;
              appliedCategory = cat;
            }
          }
          batch.push(headerToRawMessage(header, origin, appliedCategory));
          if (batch.length >= BATCH_FLUSH) await flush();
          if (scanned % PROGRESS_EVERY === 0) {
            broadcast({
              type: "backfill-progress",
              scanned,
              tagged,
              done: false,
            });
          }
        }
        if (!page.id) break;
        page = await messenger.messages.continueList(page.id);
      }
    };

    for (const f of inboxes) await visit(f, "inbox");
    for (const f of sents) await visit(f, "sent");

    await flush();
    broadcast({ type: "backfill-progress", scanned, tagged, done: true });
    console.info(`[NeoInbox] backfill done: ${tagged}/${scanned} tagged`);
    return { scanned, tagged };
  } finally {
    running = false;
  }
}

export const reclassifyAll = async (): Promise<{ scanned: number; updated: number }> => {
  await ensureTagsRegistered();
  const cached = await db.messages.toArray();
  let scanned = 0;
  let updated = 0;
  let batch: RawMessage[] = [];

  for (const cachedMsg of cached) {
    if (cachedMsg.origin !== "inbox") continue;
    scanned++;
    let header: messenger.messages.MessageHeader;
    try {
      header = await messenger.messages.get(cachedMsg.id);
    } catch {
      continue;
    }
    const before = categoryFromTags(header.tags);
    const cat = await classifyAndTag({ ...header, tags: header.tags ?? [] });
    if (cat && cat !== before) updated++;
    const fresh = await messenger.messages.get(cachedMsg.id);
    batch.push(headerToRawMessage(fresh, "inbox", cat));
    if (batch.length >= BATCH_FLUSH) {
      await db.messages.bulkPut(batch);
      broadcast({ type: "delta", updated: batch });
      batch = [];
    }
    if (scanned % PROGRESS_EVERY === 0) {
      broadcast({ type: "backfill-progress", scanned, tagged: updated, done: false });
    }
  }
  if (batch.length) {
    await db.messages.bulkPut(batch);
    broadcast({ type: "delta", updated: batch });
  }
  broadcast({ type: "backfill-progress", scanned, tagged: updated, done: true });
  return { scanned, updated };
}

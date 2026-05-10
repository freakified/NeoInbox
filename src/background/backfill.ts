import { applyMessageDetails, classifyMessage } from "./ingest";
import { headerToRawMessage } from "./messageMap";
import { broadcast } from "./port";
import { db } from "../store/db";
import { collectInboxFolders, collectSentFolders } from "../shared/folders";
import { log } from "../shared/log";
import type { ServerMsg } from "../shared/messaging";
import type { Category, RawMessage } from "../shared/types";

const PROGRESS_EVERY = 50;
const BATCH_FLUSH = 100;

let running = false;
let reclassifying = false;
let lastProgress: ServerMsg | null = null;

const sendProgress = (msg: Extract<ServerMsg, { type: "backfill-progress" }>): void => {
  lastProgress = msg;
  broadcast(msg);
};

export const getLastProgress = (): ServerMsg | null => lastProgress;

export const runBackfill = async (): Promise<{
  scanned: number;
  classified: number;
}> => {
  if (running) {
    sendProgress({ type: "backfill-progress", scanned: 0, classified: 0, done: true });
    return { scanned: 0, classified: 0 };
  }
  running = true;

  let scanned = 0;
  let classified = 0;
  let errored: string | null = null;
  const liveIds = new Set<number>();

  try {
    const [inboxes, sents] = await Promise.all([
      collectInboxFolders(),
      collectSentFolders(),
    ]);

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
          liveIds.add(header.id);
          let appliedCategory: Category | null = null;
          if (origin === "inbox") {
            appliedCategory = await classifyMessage(header);
            if (appliedCategory) classified++;
          }
          const raw = headerToRawMessage(header, origin, appliedCategory);
          const cached = await db.messages.get(header.id);
          await applyMessageDetails(raw, cached);
          batch.push(raw);
          if (batch.length >= BATCH_FLUSH) await flush();
          if (scanned % PROGRESS_EVERY === 0) {
            sendProgress({
              type: "backfill-progress",
              scanned,
              classified,
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

    const cached = await db.messages.toArray();
    const orphans = cached.filter((m) => !liveIds.has(m.id)).map((m) => m.id);
    if (orphans.length) {
      await db.messages.bulkDelete(orphans);
      broadcast({ type: "delta", removedIds: orphans });
      log.info("backfill", `pruned ${orphans.length} orphaned cache entries`);
    }

    log.info("backfill", `done: ${classified}/${scanned} classified`);
  } catch (e) {
    errored = e instanceof Error ? e.message : String(e);
    log.error("backfill", "failed", e);
  } finally {
    try {
      sendProgress({
        type: "backfill-progress",
        scanned,
        classified,
        done: true,
        ...(errored ? { error: errored } : {}),
      });
    } catch (e) {
      log.warn("backfill", "final progress broadcast failed", e);
    }
    running = false;
  }

  return { scanned, classified };
};

export const reclassifyAll = async (): Promise<{ scanned: number; updated: number }> => {
  if (reclassifying) {
    sendProgress({ type: "backfill-progress", scanned: 0, classified: 0, done: true });
    return { scanned: 0, updated: 0 };
  }
  reclassifying = true;

  let scanned = 0;
  let updated = 0;
  let errored: string | null = null;

  try {
    const cached = await db.messages.toArray();
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
      const before = cachedMsg.category;
      const cat = await classifyMessage(header);
      if (cat !== before) updated++;
      const fresh = await messenger.messages.get(cachedMsg.id);
      const raw = headerToRawMessage(fresh, "inbox", cat);
      await applyMessageDetails(raw, cachedMsg);
      batch.push(raw);
      if (batch.length >= BATCH_FLUSH) {
        await db.messages.bulkPut(batch);
        broadcast({ type: "delta", updated: batch });
        batch = [];
      }
      if (scanned % PROGRESS_EVERY === 0) {
        sendProgress({ type: "backfill-progress", scanned, classified: updated, done: false });
      }
    }
    if (batch.length) {
      await db.messages.bulkPut(batch);
      broadcast({ type: "delta", updated: batch });
    }
  } catch (e) {
    errored = e instanceof Error ? e.message : String(e);
    log.error("reclassify", "failed", e);
  } finally {
    try {
      sendProgress({
        type: "backfill-progress",
        scanned,
        classified: updated,
        done: true,
        ...(errored ? { error: errored } : {}),
      });
    } catch (e) {
      log.warn("reclassify", "final progress broadcast failed", e);
    }
    reclassifying = false;
  }

  return { scanned, updated };
};

import {
  applyMessageDetails,
  classifyMessage,
  extractMessageDetails,
  MESSAGE_DETAILS_VERSION,
  needsMessageDetails,
} from "./ingest";
import { applyLocalState } from "./localState";
import { headerToRawMessage } from "./messageMap";
import { broadcast } from "./port";
import { beginScan, endScan, wasCachedDuringScan, wasRemovedDuringScan } from "./scanGuard";
import { db } from "../store/db";
import { sanitizeTags } from "../shared/categories";
import {
  collectDraftFolders,
  collectInboxFolders,
  collectSentFolders,
  type InboxFolder,
} from "../shared/folders";
import { log } from "../shared/log";
import type { ServerMsg } from "../shared/messaging";
import type { Category, FolderCursorRecord, MessageOrigin, RawMessage } from "../shared/types";

const PROGRESS_EVERY = 50;
const BATCH_FLUSH = 100;
/** Only scan this much sent history; older sent mail already cached is kept. */
const SENT_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
/** Incremental scans re-read this far behind the cursor to absorb date skew. */
const CURSOR_OVERLAP_MS = 3 * 24 * 60 * 60 * 1000;
const PER_MESSAGE_TIMEOUT_MS = 15_000;
/** Max messages hydrated per fillMissingDetails run; the periodic sweep continues the rest. */
const DETAILS_FILL_LIMIT = 400;

type ScanMode = "full" | "incremental";

interface ScanCounters {
  scanned: number;
  classified: number;
}

let fullScanQueued = false;
let incrementalScanQueued = false;
let reclassifyQueued = false;
let fillingDetails = false;
let lastProgress: ServerMsg | null = null;

/** Scans and reclassifies run one at a time so their batches never interleave. */
let chain: Promise<unknown> = Promise.resolve();
const serialized = <T>(work: () => Promise<T>): Promise<T> => {
  const run = chain.then(work, work);
  chain = run.catch(() => undefined);
  return run;
};

const sendProgress = (msg: Extract<ServerMsg, { type: "backfill-progress" }>): void => {
  lastProgress = msg;
  broadcast(msg);
};

export const getLastProgress = (): ServerMsg | null => lastProgress;

export const withTimeout = async <T>(work: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${PER_MESSAGE_TIMEOUT_MS}ms`)),
          PER_MESSAGE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const folderIdOf = (header: messenger.messages.MessageHeader): string => {
  return (
    header as messenger.messages.MessageHeader & {
      folder?: { id?: string };
    }
  ).folder?.id ?? "";
};

type Page = { id?: string | null; messages?: messenger.messages.MessageHeader[] };

async function* iterateFolder(
  folderId: string,
  fromDate?: number,
): AsyncGenerator<messenger.messages.MessageHeader> {
  const fid = folderId as unknown as messenger.folders.MailFolderId;
  let page: Page =
    fromDate === undefined
      ? await messenger.messages.list(fid)
      : ((await messenger.messages.query({
          folderId: fid,
          fromDate: new Date(fromDate),
        })) as Page);
  while (true) {
    for (const header of page.messages ?? []) yield header;
    if (!page.id) return;
    page = await messenger.messages.continueList(page.id);
  }
}

const tagsEqual = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((t, i) => t === b[i]);

const isUnchanged = (
  cached: RawMessage,
  header: messenger.messages.MessageHeader,
  origin: MessageOrigin,
): boolean =>
  cached.origin === origin &&
  cached.folderId === folderIdOf(header) &&
  cached.date === (header.date ? new Date(header.date).getTime() : 0) &&
  cached.read === (header.read ?? false) &&
  cached.size === (header.size ?? 0) &&
  tagsEqual(cached.tags, sanitizeTags(header.tags)) &&
  Array.isArray(cached.attachments) &&
  Array.isArray(cached.references) &&
  Array.isArray(cached.inReplyTo);

/** Sent/draft details (references for threading) are filled later by fillMissingDetails. */
const applyHeadersFirstDetails = (raw: RawMessage, cached?: RawMessage): void => {
  if (cached && Array.isArray(cached.references) && Array.isArray(cached.inReplyTo)) {
    raw.attachments = Array.isArray(cached.attachments) ? cached.attachments : [];
    raw.references = cached.references;
    raw.inReplyTo = cached.inReplyTo;
    raw.detailsVersion = cached.detailsVersion;
    return;
  }
  raw.attachments = [];
  raw.references = [];
  raw.inReplyTo = [];
  raw.detailsVersion = 0;
};

const ingestHeader = async (
  header: messenger.messages.MessageHeader,
  origin: MessageOrigin,
): Promise<{ raw: RawMessage | null; classified: boolean }> => {
  const cached = await db.messages.get(header.id);
  if (cached && isUnchanged(cached, header, origin)) {
    return { raw: null, classified: false };
  }
  let category: Category | null = null;
  let classified = false;
  if (origin === "inbox") {
    if (cached) {
      category = cached.category;
    } else {
      category = await classifyMessage(header);
      if (category) classified = true;
    }
  }
  const raw = headerToRawMessage(header, origin, category);
  await applyLocalState(raw);
  if (origin === "inbox") {
    await applyMessageDetails(raw, cached);
  } else {
    applyHeadersFirstDetails(raw, cached);
  }
  return { raw, classified };
};

const visitFolder = async (
  folder: InboxFolder,
  origin: MessageOrigin,
  mode: ScanMode,
  counters: ScanCounters,
  announce: boolean,
): Promise<void> => {
  const cursor = await db.folderCursors.get(folder.id);
  const now = Date.now();
  const sentCutoff = origin === "sent" ? now - SENT_WINDOW_MS : 0;
  let fromDate: number | undefined;
  if (mode === "incremental" && cursor) {
    fromDate = Math.max(cursor.maxDate - CURSOR_OVERLAP_MS, sentCutoff);
  } else if (sentCutoff) {
    fromDate = sentCutoff;
  }

  const liveIds = new Set<number>();
  let maxDate = cursor?.maxDate ?? 0;
  let batch: RawMessage[] = [];

  const flush = async (): Promise<void> => {
    if (!batch.length) return;
    const rows = batch.filter((m) => !wasRemovedDuringScan(m.id));
    batch = [];
    if (!rows.length) return;
    await db.messages.bulkPut(rows);
    broadcast({ type: "delta", added: rows });
  };

  for await (const header of iterateFolder(folder.id, fromDate)) {
    counters.scanned++;
    liveIds.add(header.id);
    // Future-dated messages must not push the cursor past "now" or new mail
    // would fall behind the next incremental window.
    const dateMs = Math.min(header.date ? new Date(header.date).getTime() : 0, now);
    if (dateMs > maxDate) maxDate = dateMs;
    try {
      const { raw, classified } = await withTimeout(
        ingestHeader(header, origin),
        `ingest message ${header.id}`,
      );
      if (classified) counters.classified++;
      if (raw) {
        batch.push(raw);
        if (batch.length >= BATCH_FLUSH) await flush();
      }
    } catch (e) {
      log.warn("backfill", "skipping message after per-message failure", {
        id: header.id,
        origin,
        e: String(e),
      });
    }
    if (announce && counters.scanned % PROGRESS_EVERY === 0) {
      sendProgress({
        type: "backfill-progress",
        scanned: counters.scanned,
        classified: counters.classified,
        done: false,
      });
    }
  }
  await flush();

  if (mode === "full") {
    const cachedRows = await db.messages.where("folderId").equals(folder.id).toArray();
    const stale = cachedRows
      .filter(
        (m) =>
          !liveIds.has(m.id) &&
          m.origin !== "done" &&
          !m.snoozed &&
          !wasCachedDuringScan(m.id) &&
          (sentCutoff === 0 || m.date >= sentCutoff),
      )
      .map((m) => m.id);
    if (stale.length) {
      await db.messages.bulkDelete(stale);
      broadcast({ type: "delta", removedIds: stale });
      log.info("backfill", `pruned ${stale.length} stale entries from ${folder.name}`);
    }
  }

  const record: FolderCursorRecord = {
    folderId: folder.id,
    maxDate,
    fullScanAt: mode === "full" ? now : cursor?.fullScanAt ?? 0,
  };
  await db.folderCursors.put(record);
};

/**
 * Cheap drift detection: if the folder's message count disagrees with the
 * cache, some event was missed and the folder gets a full revisit. Sent is
 * skipped because the scan window makes counts differ by design.
 */
const folderDrifted = async (folder: InboxFolder, origin: MessageOrigin): Promise<boolean> => {
  if (origin === "sent") return false;
  try {
    const info = await messenger.folders.getFolderInfo(
      folder.id as unknown as messenger.folders.MailFolderId,
    );
    if (typeof info.totalMessageCount !== "number") return false;
    const cachedRows = await db.messages.where("folderId").equals(folder.id).toArray();
    const cachedCount = cachedRows.filter((m) => !m.snoozed).length;
    if (cachedCount === info.totalMessageCount) return false;
    log.info("backfill", "folder drift detected", {
      folder: folder.name,
      cached: cachedCount,
      actual: info.totalMessageCount,
    });
    return true;
  } catch (e) {
    log.warn("backfill", "drift check failed", { folder: folder.name, e: String(e) });
    return false;
  }
};

/** Removes rows stranded in folders that no longer play a scanned role. */
const pruneUnknownFolders = async (knownFolderIds: readonly string[]): Promise<void> => {
  const known = new Set(knownFolderIds);
  const stale = (await db.messages.toArray())
    .filter(
      (m) =>
        m.folderId !== "" &&
        !known.has(m.folderId) &&
        m.origin !== "done" &&
        !m.snoozed &&
        !wasCachedDuringScan(m.id),
    )
    .map((m) => m.id);
  if (!stale.length) return;
  await db.messages.bulkDelete(stale);
  broadcast({ type: "delta", removedIds: stale });
  log.info("backfill", `pruned ${stale.length} entries from unscanned folders`);
};

const runScan = (mode: ScanMode): Promise<ScanCounters> => {
  // A full scan may queue behind a running incremental sweep (it is a repair
  // request), but duplicate fulls and any incremental during other scan work
  // are dropped.
  const duplicate = mode === "full" ? fullScanQueued : fullScanQueued || incrementalScanQueued;
  if (duplicate) {
    if (lastProgress) broadcast(lastProgress);
    return Promise.resolve({ scanned: 0, classified: 0 });
  }
  if (mode === "full") fullScanQueued = true;
  else incrementalScanQueued = true;
  // Full scans drive the UI progress bar; incremental sweeps stay silent
  // (their deltas still flow) so the periodic alarm doesn't flash the UI.
  const announce = mode === "full";
  return serialized(async () => {
    beginScan();
    const counters: ScanCounters = { scanned: 0, classified: 0 };
    let errored: string | null = null;
    try {
      const [inboxes, sents, drafts] = await Promise.all([
        collectInboxFolders(),
        collectSentFolders(),
        collectDraftFolders(),
      ]);
      const scheduled: [InboxFolder, MessageOrigin][] = [
        ...inboxes.map((f): [InboxFolder, MessageOrigin] => [f, "inbox"]),
        ...sents.map((f): [InboxFolder, MessageOrigin] => [f, "sent"]),
        ...drafts.map((f): [InboxFolder, MessageOrigin] => [f, "draft"]),
      ];
      for (const [folder, origin] of scheduled) {
        let folderMode = mode;
        if (mode === "incremental") {
          const cursor = await db.folderCursors.get(folder.id);
          if (!cursor?.fullScanAt || (await folderDrifted(folder, origin))) {
            folderMode = "full";
          }
        }
        await visitFolder(folder, origin, folderMode, counters, announce);
      }
      if (mode === "full") {
        await pruneUnknownFolders(scheduled.map(([f]) => f.id));
      }
      log.info(
        "backfill",
        `${mode} scan done: ${counters.classified}/${counters.scanned} classified`,
      );
    } catch (e) {
      errored = e instanceof Error ? e.message : String(e);
      log.error("backfill", `${mode} scan failed`, e);
    } finally {
      endScan();
      if (mode === "full") fullScanQueued = false;
      else incrementalScanQueued = false;
      if (announce || errored) {
        try {
          sendProgress({
            type: "backfill-progress",
            scanned: counters.scanned,
            classified: counters.classified,
            done: true,
            ...(errored ? { error: errored } : {}),
          });
        } catch (e) {
          log.warn("backfill", "final progress broadcast failed", e);
        }
      }
      void fillMissingDetails().catch((e) =>
        log.warn("backfill", "details hydration failed", e),
      );
    }
    return counters;
  });
};

export const runBackfill = (): Promise<{ scanned: number; classified: number }> =>
  runScan("full");

export const runIncrementalSync = async (): Promise<void> => {
  await runScan("incremental");
};

/** Incremental when cursors exist from a completed full scan, full otherwise. */
export const runStartupSync = async (): Promise<void> => {
  const cursors = await db.folderCursors.toArray();
  const hasFull = cursors.some((c) => c.fullScanAt > 0);
  await runScan(hasFull ? "incremental" : "full");
};

/**
 * Hydrates references/inReplyTo (and inbox attachments) for rows ingested
 * headers-first, newest first, a bounded chunk per run. Runs after every scan
 * and keeps going on the periodic sweep until nothing is left.
 */
export const fillMissingDetails = async (limit = DETAILS_FILL_LIMIT): Promise<void> => {
  if (fillingDetails) return;
  fillingDetails = true;
  try {
    const pending = (await db.messages.toArray())
      .filter(needsMessageDetails)
      .sort((a, b) => b.date - a.date)
      .slice(0, limit);
    if (!pending.length) return;
    log.info("backfill", `hydrating details for ${pending.length} messages`);
    let updated: RawMessage[] = [];
    const flushUpdated = (): void => {
      if (!updated.length) return;
      broadcast({ type: "delta", updated });
      updated = [];
    };
    for (const msg of pending) {
      try {
        const details = await withTimeout(
          extractMessageDetails(msg.id),
          `details for message ${msg.id}`,
        );
        const row = await db.transaction("rw", db.messages, async () => {
          const fresh = await db.messages.get(msg.id);
          if (!fresh) return null;
          const next: RawMessage = {
            ...fresh,
            attachments: fresh.origin === "inbox" ? details.attachments : [],
            references: details.references,
            inReplyTo: details.inReplyTo,
            detailsVersion: MESSAGE_DETAILS_VERSION,
          };
          await db.messages.put(next);
          return next;
        });
        if (row) {
          updated.push(row);
          if (updated.length >= BATCH_FLUSH) flushUpdated();
        }
      } catch (e) {
        log.debug("backfill", "details hydration skipped a message", {
          id: msg.id,
          e: String(e),
        });
      }
    }
    flushUpdated();
  } finally {
    fillingDetails = false;
  }
};

export const reclassifyAll = (): Promise<{ scanned: number; updated: number }> => {
  if (reclassifyQueued) {
    sendProgress({ type: "backfill-progress", scanned: 0, classified: 0, done: true });
    return Promise.resolve({ scanned: 0, updated: 0 });
  }
  reclassifyQueued = true;
  return serialized(async () => {
    beginScan();
    let scanned = 0;
    let updated = 0;
    let errored: string | null = null;
    try {
      const cached = await db.messages.toArray();
      let batch: RawMessage[] = [];

      const flush = async (): Promise<void> => {
        if (!batch.length) return;
        const rows = batch.filter((m) => !wasRemovedDuringScan(m.id));
        batch = [];
        if (!rows.length) return;
        await db.messages.bulkPut(rows);
        broadcast({ type: "delta", updated: rows });
      };

      for (const cachedMsg of cached) {
        if (cachedMsg.origin !== "inbox") continue;
        scanned++;
        try {
          const header = await withTimeout(
            messenger.messages.get(cachedMsg.id),
            `reclassify message ${cachedMsg.id}`,
          );
          const cat = await classifyMessage(header);
          if (cat !== cachedMsg.category) updated++;
          const raw = headerToRawMessage(header, "inbox", cat);
          await applyLocalState(raw);
          await applyMessageDetails(raw, cachedMsg);
          batch.push(raw);
          if (batch.length >= BATCH_FLUSH) await flush();
        } catch (e) {
          log.warn("reclassify", "skipping message after per-message failure", {
            id: cachedMsg.id,
            e: String(e),
          });
        }
        if (scanned % PROGRESS_EVERY === 0) {
          sendProgress({ type: "backfill-progress", scanned, classified: updated, done: false });
        }
      }
      await flush();
    } catch (e) {
      errored = e instanceof Error ? e.message : String(e);
      log.error("reclassify", "failed", e);
    } finally {
      endScan();
      reclassifyQueued = false;
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
    }
    return { scanned, updated };
  });
};

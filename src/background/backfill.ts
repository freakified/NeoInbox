import {
  applyMessageDetails,
  classifyMessage,
  DETAILS_LAZY,
  isHeaderOnly,
  loadMessageBody,
  type MessageBody,
} from "./ingest";
import {
  applyClassification,
  carryClassification,
  classificationOutdated,
} from "../classifier/version";
import { applyLocalState } from "./localState";
import { headerToRawMessage, keyOfHeader } from "./messageMap";
import { broadcast } from "./port";
import { beginScan, endScan, wasCachedDuringScan, wasRemovedDuringScan } from "./scanGuard";
import { db } from "../store/db";
import { retryIncompleteClassifications } from "./classifierSweep";
import { fillMissingDetails } from "./detailsFill";
import {
  BATCH_FLUSH,
  PROGRESS_EVERY,
  getLastProgress,
  sendProgress,
  serialized,
  withTimeout,
} from "./scanQueue";
import { sanitizeTags } from "../shared/categories";
import {
  collectDraftFolders,
  collectInboxFolders,
  collectSentFolders,
  type InboxFolder,
} from "../shared/folders";
import { log } from "../shared/log";
import type { MessageKey } from "../shared/messageKey";
import type { FolderCursorRecord, MessageOrigin, RawMessage } from "../shared/types";

/** Only scan this much sent history; older sent mail already cached is kept. */
const SENT_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
/** Incremental scans re-read this far behind the cursor to absorb date skew. */
const CURSOR_OVERLAP_MS = 3 * 24 * 60 * 60 * 1000;
/**
 * Folder-level calls get a longer budget than per-message work (a page of a
 * large folder is legitimately slow), but they must have one: an IMAP
 * connection that stalls mid-listing would otherwise leave the scan promise
 * pending forever, and with it the queue flag that gates every later sync.
 */
const FOLDER_OP_TIMEOUT_MS = 60_000;

/**
 * How many inbox messages a full scan fully processes, newest first.
 *
 * Classifying a message costs a body fetch, so an uncapped scan of a large
 * inbox is thousands of them before the app is usable. The cap bounds that.
 * Anything older is left out until Settings → Older mail brings it in from
 * headers alone (see inboxImport.ts). Only full scans are capped — incremental
 * ones are bounded by the folder cursor instead, so new mail always arrives.
 */
export const INBOX_SCAN_CAP = 1000;
/** A stored override of the cap, for tests and debugging. */
const INBOX_CAP_KEY = "neoinbox-inbox-cap";

export const getInboxScanCap = async (): Promise<number> => {
  try {
    const stored = await messenger.storage.local.get(INBOX_CAP_KEY);
    const cap = Number(stored[INBOX_CAP_KEY]);
    return Number.isFinite(cap) && cap > 0 ? cap : INBOX_SCAN_CAP;
  } catch (e) {
    log.warn("backfill", "reading the inbox cap failed; using the default", e);
    return INBOX_SCAN_CAP;
  }
};

const dateOf = (header: messenger.messages.MessageHeader): number =>
  header.date ? new Date(header.date).getTime() : 0;

/** Keeps the newest `cap` headers and drops the rest, in place. */
const trimToNewest = (
  headers: messenger.messages.MessageHeader[],
  cap: number,
): void => {
  if (headers.length <= cap) return;
  headers.sort((a, b) => dateOf(b) - dateOf(a));
  headers.length = cap;
};

type ScanMode = "full" | "incremental";

interface ScanCounters {
  scanned: number;
  /** Fresh classifications that produced a category; drives the progress bar. */
  classified: number;
  /**
   * How many rows actually ran the pipeline. Scans reuse a cached row's
   * category, so `classified: 0` is ambiguous on its own — it reads the same
   * whether every row was already current or the scan classified nothing it
   * should have. This separates the two.
   */
  reclassified: number;
  /** Inbox messages not cached at all; drives Settings → Older mail. */
  skippedOlder: number;
}

let fullScanQueued = false;
let incrementalScanQueued = false;

const folderIdOf = (header: messenger.messages.MessageHeader): string => {
  return (
    header as messenger.messages.MessageHeader & {
      folder?: { id?: string };
    }
  ).folder?.id ?? "";
};

type Page = { id?: string | null; messages?: messenger.messages.MessageHeader[] };

export async function* iterateFolder(
  folderId: string,
  fromDate?: number,
): AsyncGenerator<messenger.messages.MessageHeader> {
  const fid = folderId as unknown as messenger.folders.MailFolderId;
  let page: Page = await withTimeout(
    fromDate === undefined
      ? messenger.messages.list(fid)
      : (messenger.messages.query({
          folderId: fid,
          fromDate: new Date(fromDate),
        }) as Promise<Page>),
    `list folder ${folderId}`,
    FOLDER_OP_TIMEOUT_MS,
  );
  while (true) {
    for (const header of page.messages ?? []) yield header;
    if (!page.id) return;
    page = await withTimeout(
      messenger.messages.continueList(page.id),
      `continue listing folder ${folderId}`,
      FOLDER_OP_TIMEOUT_MS,
    );
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
  // A restart renumbers everything; the row has to learn the new id.
  cached.tbId === header.id &&
  cached.folderId === folderIdOf(header) &&
  cached.date === (header.date ? new Date(header.date).getTime() : 0) &&
  cached.read === (header.read ?? false) &&
  cached.size === (header.size ?? 0) &&
  tagsEqual(cached.tags, sanitizeTags(header.tags)) &&
  Array.isArray(cached.attachments) &&
  Array.isArray(cached.references) &&
  Array.isArray(cached.inReplyTo);

/**
 * Sent/draft rows are cached from their headers alone. Details are fetched on
 * demand when a conversation is opened (see DETAILS_LAZY), never swept for in
 * the background — that sweep was a body fetch per sent message.
 */
const applyHeadersFirstDetails = (raw: RawMessage, cached?: RawMessage): void => {
  if (cached && Array.isArray(cached.references) && Array.isArray(cached.inReplyTo)) {
    raw.attachments = Array.isArray(cached.attachments) ? cached.attachments : [];
    raw.references = cached.references;
    raw.inReplyTo = cached.inReplyTo;
    raw.snippet = cached.snippet;
    raw.detailsVersion = cached.detailsVersion;
    return;
  }
  raw.attachments = [];
  raw.references = [];
  raw.inReplyTo = [];
  raw.detailsVersion = DETAILS_LAZY;
};

const ingestHeader = async (
  header: messenger.messages.MessageHeader,
  origin: MessageOrigin,
): Promise<{ raw: RawMessage | null; classified: boolean; ranPipeline: boolean }> => {
  const cached = await db.messages.get(keyOfHeader(header));
  // A row whose category predates the current rules must not take the
  // unchanged fast path: nothing else in a scan re-runs the pipeline, so it
  // would keep its stale category through any number of rescans.
  const outdated = origin === "inbox" && classificationOutdated(cached);
  // Older inbox mail cached from headers that the window has now reached
  // (an import that ran before the first scan, or a window that moved) gets
  // what every message in the window gets: its body.
  const upgrade = origin === "inbox" && !!cached && isHeaderOnly(cached);
  if (cached && !outdated && !upgrade && isUnchanged(cached, header, origin)) {
    return { raw: null, classified: false, ranPipeline: false };
  }
  let classified = false;
  let ranPipeline = false;
  const raw = headerToRawMessage(header, origin);
  // Fetched here only when the classifier needs it, then handed to
  // applyMessageDetails so the two share one getFull. When classification is
  // skipped, applyMessageDetails still fetches lazily — and often not at all,
  // since it reuses the cached row's details when the size matches.
  let body: MessageBody | undefined;
  if (origin === "inbox" && (!cached || outdated || upgrade)) {
    body = await loadMessageBody(header.id);
    const result = await classifyMessage(header, body);
    applyClassification(raw, result);
    ranPipeline = true;
    if (result.category) classified = true;
  } else if (origin === "inbox") {
    carryClassification(raw, cached);
  }
  await applyLocalState(raw);
  if (origin === "inbox") {
    await applyMessageDetails(raw, cached, body);
  } else {
    applyHeadersFirstDetails(raw, cached);
  }
  return { raw, classified, ranPipeline };
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

  const liveKeys = new Set<MessageKey>();
  let maxDate = cursor?.maxDate ?? 0;
  let batch: RawMessage[] = [];

  const flush = async (): Promise<void> => {
    if (!batch.length) return;
    const rows = batch.filter((m) => !wasRemovedDuringScan(m.key));
    batch = [];
    if (!rows.length) return;
    await db.messages.bulkPut(rows);
    broadcast({ type: "delta", added: rows });
  };

  const ingestOne = async (header: messenger.messages.MessageHeader): Promise<void> => {
    counters.scanned++;
    liveKeys.add(keyOfHeader(header));
    try {
      const { raw, classified, ranPipeline } = await withTimeout(
        ingestHeader(header, origin),
        `ingest message ${header.id}`,
      );
      if (classified) counters.classified++;
      if (ranPipeline) counters.reclassified++;
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
  };

  // Only a full inbox sweep is capped. Enumerating headers is cheap; it is
  // classifying them that costs a body fetch each, so the window is applied
  // between the two — every header is seen (the cursor and the drift check
  // depend on that), only the newest `cap` are ingested.
  const cap = mode === "full" && origin === "inbox" ? await getInboxScanCap() : null;
  const window: messenger.messages.MessageHeader[] = [];
  let seen = 0;

  for await (const header of iterateFolder(folder.id, fromDate)) {
    seen++;
    // Future-dated messages must not push the cursor past "now" or new mail
    // would fall behind the next incremental window.
    const dateMs = Math.min(dateOf(header), now);
    if (dateMs > maxDate) maxDate = dateMs;
    if (cap === null) {
      await ingestOne(header);
      continue;
    }
    // Outside the window or not, the message is in the folder: a row the
    // inbox import cached for it is not stale.
    liveKeys.add(keyOfHeader(header));
    window.push(header);
    // Trimming on a multiple of the cap keeps this O(n log cap) overall rather
    // than sorting on every push, while bounding what's held to 2x the window.
    if (window.length >= cap * 2) trimToNewest(window, cap);
  }

  if (cap !== null) {
    trimToNewest(window, cap);
    for (const header of window) await ingestOne(header);
  }
  await flush();

  if (cap !== null && seen > window.length) {
    log.info("backfill", `inbox window: ingested ${window.length} of ${seen} in ${folder.name}`, {
      cap,
    });
  }

  if (mode === "full") {
    const cachedRows = await db.messages.where("folderId").equals(folder.id).toArray();
    const stale = cachedRows
      .filter(
        (m) =>
          !liveKeys.has(m.key) &&
          m.origin !== "done" &&
          !m.snoozed &&
          !wasCachedDuringScan(m.key) &&
          (sentCutoff === 0 || m.date >= sentCutoff),
      )
      .map((m) => m.key);
    if (stale.length) {
      await db.messages.bulkDelete(stale);
      broadcast({ type: "delta", removedKeys: stale });
      log.info("backfill", `pruned ${stale.length} stale entries from ${folder.name}`);
    }
  }

  // Measured after the prune, so they describe what is cached now. A capped
  // scan saw every key in the folder (see liveKeys above), so the missing
  // ones are exactly the mail neither the window nor an import has loaded.
  if (cap !== null) counters.skippedOlder += await countMissing(liveKeys);
  const countGap = cap === null ? cursor?.countGap : await countGapIn(folder);
  const record: FolderCursorRecord = {
    folderId: folder.id,
    maxDate,
    fullScanAt: mode === "full" ? now : cursor?.fullScanAt ?? 0,
    ...(countGap ? { countGap } : {}),
  };
  await db.folderCursors.put(record);
};

/**
 * How many of these keys have no cached row. Counted by key rather than by
 * comparing the folder's size with the cache: two copies of one message share
 * a key and a row, so a size comparison would report the second copy as
 * missing for good.
 */
const countMissing = async (keys: Iterable<MessageKey>): Promise<number> => {
  const all = [...keys];
  let missing = 0;
  for (let i = 0; i < all.length; i += 500) {
    const rows = await db.messages.bulkGet(all.slice(i, i + 500));
    missing += rows.filter((row) => !row).length;
  }
  return missing;
};

/**
 * How far the folder's own message count runs ahead of the cached rows in it:
 * mail outside the scan window, duplicate copies, anything Thunderbird counts
 * but doesn't list. The drift check adds it back. 0 if the folder won't say.
 */
const countGapIn = async (folder: InboxFolder): Promise<number> => {
  try {
    const info = await withTimeout(
      messenger.folders.getFolderInfo(folder.id as unknown as messenger.folders.MailFolderId),
      `folder info ${folder.name}`,
      FOLDER_OP_TIMEOUT_MS,
    );
    if (typeof info.totalMessageCount !== "number") return 0;
    const cached = await db.messages.where("folderId").equals(folder.id).count();
    return Math.max(info.totalMessageCount - cached, 0);
  } catch (e) {
    log.warn("backfill", "couldn't measure the inbox's count gap", { folder: folder.name, e: String(e) });
    return 0;
  }
};

/**
 * Re-counts the unloaded inbox mail after the inbox import, keeping each
 * folder's cursor in step so the drift check doesn't read the import as
 * missed events, and tells the SPA how much is still left out. Lists each
 * inbox again to count by key, which is a read of Thunderbird's local index.
 */
export const refreshInboxWindow = async (): Promise<void> => {
  let skipped = 0;
  for (const folder of await collectInboxFolders()) {
    const keys = new Set<MessageKey>();
    for await (const header of iterateFolder(folder.id)) keys.add(keyOfHeader(header));
    skipped += await countMissing(keys);
    const countGap = await countGapIn(folder);
    const cursor = await db.folderCursors.get(folder.id);
    if (cursor) await db.folderCursors.put({ ...cursor, countGap: countGap || undefined });
  }
  broadcast({ type: "inbox-window", cap: await getInboxScanCap(), skipped });
};

/**
 * Cheap drift detection: if the folder's message count disagrees with the
 * cache, some event was missed and the folder gets a full revisit. Sent is
 * skipped because the scan window makes counts differ by design.
 */
const folderDrifted = async (
  folder: InboxFolder,
  origin: MessageOrigin,
  snoozedByFolder: ReadonlyMap<string, number>,
): Promise<boolean> => {
  if (origin === "sent") return false;
  try {
    const info = await withTimeout(
      messenger.folders.getFolderInfo(folder.id as unknown as messenger.folders.MailFolderId),
      `folder info ${folder.name}`,
      FOLDER_OP_TIMEOUT_MS,
    );
    if (typeof info.totalMessageCount !== "number") return false;
    // count() off the index rather than toArray(): this runs for every folder
    // on every incremental sync, and it only ever needed the number.
    // A capped inbox, or one holding two copies of a message, has fewer rows
    // than the folder counts by design; the last full scan recorded by how many.
    const cursor = await db.folderCursors.get(folder.id);
    const cachedCount =
      (await db.messages.where("folderId").equals(folder.id).count()) -
      (snoozedByFolder.get(folder.id) ?? 0) +
      (cursor?.countGap ?? 0);
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

/**
 * Snoozed rows per folder, for the drift check.
 *
 * Snoozing archives the message, so a snoozed row's folder is normally not a
 * scanned one at all — but between the local snooze and the move settling it
 * still carries its old folder, and counting it would fake a drift. Snoozes
 * are user-scale, so driving off that table costs a few point lookups instead
 * of a read of every cached row.
 */
const snoozedCountsByFolder = async (): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  for (const snooze of await db.snoozes.toArray()) {
    const row = await db.messages.get(snooze.messageKey);
    if (!row?.snoozed) continue;
    counts.set(row.folderId, (counts.get(row.folderId) ?? 0) + 1);
  }
  return counts;
};

/** Removes rows stranded in folders that no longer play a scanned role. */
const pruneUnknownFolders = async (knownFolderIds: readonly string[]): Promise<void> => {
  const known = new Set(knownFolderIds);
  // Ask the index which folders the cache actually holds and read rows only
  // from the ones that lost their role. That set is almost always empty, so
  // the common case reads no rows at all.
  const cachedFolderIds = (await db.messages.orderBy("folderId").uniqueKeys()) as string[];
  const unknown = cachedFolderIds.filter((id) => id !== "" && !known.has(id));
  if (!unknown.length) return;
  const stale: MessageKey[] = [];
  for (const folderId of unknown) {
    const rows = await db.messages.where("folderId").equals(folderId).toArray();
    for (const m of rows) {
      if (m.origin === "done" || m.snoozed || wasCachedDuringScan(m.key)) continue;
      stale.push(m.key);
    }
  }
  if (!stale.length) return;
  await db.messages.bulkDelete(stale);
  broadcast({ type: "delta", removedKeys: stale });
  log.info("backfill", `pruned ${stale.length} entries from unscanned folders`);
};

const runScan = (mode: ScanMode): Promise<ScanCounters> => {
  // A full scan may queue behind a running incremental sweep (it is a repair
  // request), but duplicate fulls and any incremental during other scan work
  // are dropped.
  const duplicate = mode === "full" ? fullScanQueued : fullScanQueued || incrementalScanQueued;
  if (duplicate) {
    const last = getLastProgress();
    if (last) broadcast(last);
    return Promise.resolve({ scanned: 0, classified: 0, reclassified: 0, skippedOlder: 0 });
  }
  if (mode === "full") fullScanQueued = true;
  else incrementalScanQueued = true;
  // Full scans drive the UI progress bar; incremental sweeps stay silent
  // (their deltas still flow) so the periodic alarm doesn't flash the UI.
  const announce = mode === "full";
  return serialized(async () => {
    beginScan();
    const counters: ScanCounters = { scanned: 0, classified: 0, reclassified: 0, skippedOlder: 0 };
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
      const snoozedByFolder =
        mode === "incremental" ? await snoozedCountsByFolder() : new Map<string, number>();
      for (const [folder, origin] of scheduled) {
        let folderMode = mode;
        if (mode === "incremental") {
          const cursor = await db.folderCursors.get(folder.id);
          if (!cursor?.fullScanAt || (await folderDrifted(folder, origin, snoozedByFolder))) {
            folderMode = "full";
          }
        }
        await visitFolder(folder, origin, folderMode, counters, announce);
      }
      if (mode === "full") {
        await pruneUnknownFolders(scheduled.map(([f]) => f.id));
        // Tells the SPA how much older inbox mail is left to load.
        broadcast({
          type: "inbox-window",
          cap: await getInboxScanCap(),
          skipped: counters.skippedOlder,
        });
      }
      log.info(
        "backfill",
        // "ran the classifier" is the honest signal: the rest were either
        // already current or are sent/draft rows, which never classify.
        `${mode} scan done: ${counters.scanned} scanned, ` +
          `${counters.reclassified} ran the classifier, ` +
          `${counters.classified} categorised`,
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
      void retryIncompleteClassifications().catch((e) =>
        log.warn("backfill", "classification retry failed", e),
      );
    }
    return counters;
  });
};

export const runBackfill = (): Promise<ScanCounters> => runScan("full");

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
 * Hydrates references/inReplyTo and attachments for inbox rows ingested
 * headers-first, newest first, a bounded chunk per run. Runs after every scan
 * and keeps going on the periodic sweep until nothing is left.
 *
 * Sent and draft rows sit at DETAILS_LAZY, below the bottom of this range, and
 * are hydrated only when a conversation is opened.
 */

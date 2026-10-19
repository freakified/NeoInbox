/**
 * Settings → Advanced: brings mail archived before NeoInbox was installed into
 * the cache, as Done rows, so Done, bundle views, threading and the trip scan
 * can see it.
 *
 * Headers only, by design. On IMAP an archive can hold tens of thousands of
 * messages Thunderbird has never downloaded, and a getFull() per message
 * would pull all of them down. So rows are bundled by the header-based rules
 * alone and cached at DETAILS_LAZY, which keeps every background sweep off
 * them; a body is fetched only when the user opens the conversation, or runs
 * the trip scan over archived mail (which says so).
 *
 * Rows are not broadcast as they land; the SPA reloads Done when the
 * import's final progress message arrives.
 *
 * Listing headers is a read of Thunderbird's local index, so even a large
 * archive is minutes, not hours. Re-running skips rows already cached, which
 * is what makes a stopped import resumable.
 */
import { classify } from "../classifier/pipeline";
import { extractFeatures } from "../classifier/features";
import { CLASSIFIER_VERSION } from "../classifier/version";
import { DETAILS_LAZY } from "../shared/details";
import {
  collectArchiveFolders,
  collectDraftFolders,
  collectInboxFolders,
  collectSentFolders,
} from "../shared/folders";
import { log } from "../shared/log";
import type { ArchiveImportStatus } from "../shared/messaging";
import type { RawMessage } from "../shared/types";
import { db } from "../store/db";
import { iterateFolder } from "./backfill";
import { applyLocalState } from "./localState";
import { headerToRawMessage, keyOfHeader } from "./messageMap";
import { broadcast } from "./port";

const LAST_IMPORT_KEY = "neoinbox-archive-import";
const BATCH = 200;
const PROGRESS_EVERY_MS = 750;

/**
 * A later import's start date may drift from an earlier one's by however long
 * passed between them; "last 2 years" asked a week apart is the same range.
 */
const COVERAGE_SLACK_MS = 30 * 24 * 60 * 60 * 1000;

let status: ArchiveImportStatus | null = null;
let running: Promise<ArchiveImportStatus> | null = null;
let stopRequested = false;
let lastPublished = 0;

const publish = (next: ArchiveImportStatus, force = false): void => {
  status = next;
  if (!force && Date.now() - lastPublished < PROGRESS_EVERY_MS) return;
  lastPublished = Date.now();
  broadcast({ type: "archive-import-progress", ...next });
};

/** The running import this session, else the last one that finished. */
export const getArchiveImportStatus = async (): Promise<ArchiveImportStatus | null> => {
  if (status) return status;
  const stored = await messenger.storage.local.get(LAST_IMPORT_KEY);
  return (stored[LAST_IMPORT_KEY] as ArchiveImportStatus | undefined) ?? null;
};

export const cancelArchiveImport = (): void => {
  stopRequested = true;
};

/** The older of two coverage dates; null (everything) beats any date. */
const widest = (a: number | null | undefined, b: number | null): number | null =>
  a === null || b === null ? null : a === undefined ? b : Math.min(a, b);

/** Whether finished imports already reach back to `since` (null: everything). */
export const archiveCovers = async (since: number | null): Promise<boolean> => {
  const covered = (await getArchiveImportStatus())?.coveredSince;
  if (covered === undefined) return false;
  if (covered === null) return true;
  return since !== null && covered <= since + COVERAGE_SLACK_MS;
};

/**
 * Message-IDs that live somewhere NeoInbox already shows. Gmail's All Mail
 * holds a copy of every inbox and sent message; importing those as Done would
 * list mail that is still in the inbox. Inbox rows only cover the scan window,
 * so this lists the folders themselves rather than trusting the cache.
 */
const liveElsewhere = async (): Promise<Set<string>> => {
  const ids = new Set<string>();
  const folders = [
    ...(await collectInboxFolders()),
    ...(await collectSentFolders()),
    ...(await collectDraftFolders()),
  ];
  for (const folder of folders) {
    for await (const header of iterateFolder(folder.id)) {
      if (header.headerMessageId) ids.add(header.headerMessageId);
    }
  }
  return ids;
};

/** A header-only Done row: bundled by header rules, details fetched on open. */
const importedRow = async (header: messenger.messages.MessageHeader): Promise<RawMessage> => {
  const raw = headerToRawMessage(header, "done");
  raw.category = await classify(extractFeatures(header, {}));
  // Decided without the body. Retries are inbox-only, so this only matters if
  // the message is ever moved back to the inbox — then it gets a proper look.
  raw.classifiedIncomplete = true;
  raw.classifierVersion = CLASSIFIER_VERSION;
  raw.attachments = [];
  raw.references = [];
  raw.inReplyTo = [];
  raw.detailsVersion = DETAILS_LAZY;
  return applyLocalState(raw);
};

/**
 * Import back to `since`. While an import is already running this returns
 * that one instead of starting another; callers that need a particular range
 * check archiveCovers() once it settles.
 */
export const runArchiveImport = (since: number | null): Promise<ArchiveImportStatus> => {
  running ??= importArchive(since).finally(() => {
    running = null;
  });
  return running;
};

/** How many messages the folders hold, for a progress bar; undefined if any won't say. */
const countMessages = async (folders: readonly { id: string }[]): Promise<number | undefined> => {
  let total = 0;
  for (const folder of folders) {
    try {
      const info = await messenger.folders.getFolderInfo(
        folder.id as unknown as messenger.folders.MailFolderId,
      );
      if (typeof info.totalMessageCount !== "number") return undefined;
      total += info.totalMessageCount;
    } catch (e) {
      log.warn("archive-import", "couldn't count a folder", e);
      return undefined;
    }
  }
  return total;
};

const importArchive = async (since: number | null): Promise<ArchiveImportStatus> => {
  stopRequested = false;
  const coveredSince = (await getArchiveImportStatus())?.coveredSince;
  let current: ArchiveImportStatus = {
    running: true,
    since,
    scanned: 0,
    imported: 0,
    folders: 0,
    totalFolders: 0,
    coveredSince,
  };
  publish(current, true);

  let batch: RawMessage[] = [];
  const flush = async (): Promise<void> => {
    if (!batch.length) return;
    const rows = batch;
    batch = [];
    // Written quietly: a view filling with old mail mid-import looks like
    // something going wrong. Open tabs reload Done once the import ends.
    await db.messages.bulkPut(rows);
  };

  try {
    const archives = await collectArchiveFolders();
    current = {
      ...current,
      totalFolders: archives.length,
      total: since === null ? await countMessages(archives) : undefined,
    };
    publish(current, true);
    const skip = await liveElsewhere();

    for (const folder of archives) {
      if (stopRequested) break;
      for await (const header of iterateFolder(folder.id, since ?? undefined)) {
        if (stopRequested) break;
        current = { ...current, scanned: current.scanned + 1 };
        const mid = header.headerMessageId ?? "";
        // One row per Message-ID: a message filed in two archive folders, or
        // still in the inbox, is not imported twice.
        if (mid && skip.has(mid)) continue;
        if (mid) skip.add(mid);
        if (await db.messages.get(keyOfHeader(header))) continue;
        batch.push(await importedRow(header));
        current = { ...current, imported: current.imported + 1 };
        if (batch.length >= BATCH) await flush();
        publish(current);
      }
      current = { ...current, folders: current.folders + 1 };
      publish(current);
    }
    await flush();

    current = {
      ...current,
      running: false,
      finishedAt: Date.now(),
      cancelled: stopRequested || undefined,
      coveredSince: stopRequested ? coveredSince : widest(coveredSince, since),
    };
    await messenger.storage.local.set({ [LAST_IMPORT_KEY]: current });
    log.info("archive-import", `imported ${current.imported} of ${current.scanned} archived messages`);
  } catch (e) {
    await flush().catch(() => undefined);
    log.warn("archive-import", "import failed", e);
    current = { ...current, running: false, error: String(e) };
  } finally {
    publish(current, true);
  }
  return current;
};

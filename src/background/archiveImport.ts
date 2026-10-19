/**
 * Settings → Older mail → Archived mail: brings mail archived before NeoInbox
 * was installed into the cache, as Done rows, so Done, bundle views,
 * threading and the trip scan can see it. Two passes, like the inbox import:
 *
 * 1. Headers. Listing is a read of Thunderbird's local index, so even a large
 *    archive is minutes, not hours. Rows are cached header-only (DETAILS_LAZY)
 *    and not broadcast as they land; the SPA reloads Done when this pass ends.
 * 2. Bodies. Each listed row in range is read in full, newest first, so it is
 *    bundled from the whole message (see fullRead.ts). On IMAP that can mean
 *    downloading mail Thunderbird never had, which is why it only happens
 *    here, for a range the user picked, with progress and a Stop button.
 *
 * Re-running skips the first pass if it already reached that far and picks
 * the second up where it stopped.
 */
import { applyClassification } from "../classifier/version";
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
import { readAllInFull, unreadRows } from "./fullRead";
import { classifyFromHeader } from "./ingest";
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
export const widest = (a: number | null | undefined, b: number | null): number | null =>
  a === null || b === null ? null : a === undefined ? b : Math.min(a, b);

/** Whether finished header passes already reach back to `since` (null: everything). */
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

/**
 * A header-only row: bundled by header rules, details fetched on open. Shared
 * with the inbox import, whose rows are the same thing with an inbox origin.
 */
export const headerOnlyRow = async (
  header: messenger.messages.MessageHeader,
  origin: "done" | "inbox",
): Promise<RawMessage> => {
  const raw = headerToRawMessage(header, origin);
  applyClassification(raw, await classifyFromHeader(header));
  // Decided without the body (applyClassification marks it incomplete). The
  // retry skips header-only rows, so this matters once the row has its body:
  // opened, moved back to the inbox, or reached by the scan window.
  raw.attachments = [];
  raw.references = [];
  raw.inReplyTo = [];
  raw.detailsVersion = DETAILS_LAZY;
  return applyLocalState(raw);
};

/**
 * Import back to `since`. While an import is already running this returns
 * that one instead of starting another.
 */
export const runArchiveImport = (since: number | null): Promise<ArchiveImportStatus> => {
  running ??= importArchive(since).finally(() => {
    running = null;
  });
  return running;
};

/** How many messages the folders hold, for a progress bar; undefined if any won't say. */
export const countMessages = async (folders: readonly { id: string }[]): Promise<number | undefined> => {
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
    phase: "headers",
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
    // Pass 1: headers, unless an earlier run already listed this far.
    let reached = coveredSince;
    if (!(await archiveCovers(since))) {
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
          batch.push(await headerOnlyRow(header, "done"));
          current = { ...current, imported: current.imported + 1 };
          if (batch.length >= BATCH) await flush();
          publish(current);
        }
        current = { ...current, folders: current.folders + 1 };
        publish(current);
      }
      await flush();
      if (!stopRequested) reached = widest(coveredSince, since);
    }

    // Pass 2: bodies. The phase change is the SPA's cue to load pass 1's rows.
    const todo = stopRequested ? [] : await unreadRows("done", since);
    current = { ...current, phase: "bodies", coveredSince: reached, sorted: 0, toSort: todo.length };
    publish(current, true);
    await readAllInFull(todo, "done", {
      shouldStop: () => stopRequested,
      onRead: () => {
        current = { ...current, sorted: (current.sorted ?? 0) + 1 };
        publish(current);
      },
    });

    current = {
      ...current,
      running: false,
      phase: undefined,
      finishedAt: Date.now(),
      cancelled: stopRequested || undefined,
    };
    await messenger.storage.local.set({ [LAST_IMPORT_KEY]: current });
    log.info(
      "archive-import",
      `listed ${current.imported} archived messages, read ${current.sorted} of ${current.toSort} in full`,
    );
  } catch (e) {
    await flush().catch(() => undefined);
    log.warn("archive-import", "import failed", e);
    current = { ...current, running: false, phase: undefined, error: String(e) };
  } finally {
    publish(current, true);
  }
  return current;
};

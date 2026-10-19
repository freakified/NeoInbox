/**
 * Settings → Older mail → Inbox: brings inbox mail older than the scan window
 * into the cache, so an inbox of tens of thousands shows up in full, sorted
 * into bundles.
 *
 * A full scan fully processes only the newest INBOX_SCAN_CAP messages, since
 * each costs a body fetch and the app isn't usable until they're done. This
 * is the same work for the rest of the inbox, started by the user and in two
 * passes:
 *
 * 1. Headers. Listing a folder is a read of Thunderbird's local index, so the
 *    older mail is cached within seconds as header-only rows (DETAILS_LAZY).
 *    The SPA reloads the inbox when this pass ends, rather than taking the
 *    rows one delta at a time.
 * 2. Bodies. Each header-only row in range is read in full, newest first, and
 *    gets what a scanned message gets: its real bundle, snippet, attachments,
 *    parcels and threading. Header rules alone can't tell bulk mail (that's
 *    List-Unsubscribe and friends, which only the full message carries), so
 *    until a row has been read it can sit in the wrong bundle or none; each
 *    one corrects itself on screen as it is read.
 *
 * Stopping leaves the unread rows header-only — nothing in the background
 * reads them (see isHeaderOnly) — and running again skips the first pass if
 * it already reached that far, and picks the second up where it stopped,
 * since the rows themselves record whether they were read.
 */
import { collectInboxFolders } from "../shared/folders";
import { log } from "../shared/log";
import type { InboxImportStatus } from "../shared/messaging";
import type { RawMessage } from "../shared/types";
import { db } from "../store/db";
import { countMessages, headerOnlyRow, widest } from "./archiveImport";
import { iterateFolder, refreshInboxWindow } from "./backfill";
import { readAllInFull, unreadRows } from "./fullRead";
import { keyOfHeader } from "./messageMap";
import { broadcast } from "./port";

const LAST_IMPORT_KEY = "neoinbox-inbox-import";
const BATCH = 200;
const PROGRESS_EVERY_MS = 750;
/** Matches the archive import's: "2 years" asked a month later is the same range. */
const COVERAGE_SLACK_MS = 30 * 24 * 60 * 60 * 1000;

let status: InboxImportStatus | null = null;
let running: Promise<InboxImportStatus> | null = null;
let stopRequested = false;
let lastPublished = 0;

const publish = (next: InboxImportStatus, force = false): void => {
  status = next;
  if (!force && Date.now() - lastPublished < PROGRESS_EVERY_MS) return;
  lastPublished = Date.now();
  broadcast({ type: "inbox-import-progress", ...next });
};

/** The running import this session, else the last one that finished. */
export const getInboxImportStatus = async (): Promise<InboxImportStatus | null> => {
  if (status) return status;
  const stored = await messenger.storage.local.get(LAST_IMPORT_KEY);
  return (stored[LAST_IMPORT_KEY] as InboxImportStatus | undefined) ?? null;
};

export const cancelInboxImport = (): void => {
  stopRequested = true;
};

/** Whether finished header passes already reach back to `since` (null: everything). */
export const inboxCovers = async (since: number | null): Promise<boolean> => {
  const covered = (await getInboxImportStatus())?.coveredSince;
  if (covered === undefined) return false;
  if (covered === null) return true;
  return since !== null && covered <= since + COVERAGE_SLACK_MS;
};

/**
 * Import back to `since`. While an import is already running this returns
 * that one instead of starting another.
 */
export const runInboxImport = (since: number | null): Promise<InboxImportStatus> => {
  running ??= importInbox(since).finally(() => {
    running = null;
  });
  return running;
};

const importInbox = async (since: number | null): Promise<InboxImportStatus> => {
  stopRequested = false;
  const coveredSince = (await getInboxImportStatus())?.coveredSince;
  let current: InboxImportStatus = {
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
    // A scan running alongside may have cached some of these since they were
    // looked up, with their bodies; a header-only row must not replace that.
    await db.transaction("rw", db.messages, async () => {
      const existing = await db.messages.bulkGet(rows.map((m) => m.key));
      await db.messages.bulkPut(rows.filter((_, i) => !existing[i]));
    });
  };

  try {
    // Pass 1: headers, unless an earlier run already listed this far.
    let reached = coveredSince;
    if (!(await inboxCovers(since))) {
      const inboxes = await collectInboxFolders();
      current = {
        ...current,
        totalFolders: inboxes.length,
        total: since === null ? await countMessages(inboxes) : undefined,
      };
      publish(current, true);

      for (const folder of inboxes) {
        if (stopRequested) break;
        for await (const header of iterateFolder(folder.id, since ?? undefined)) {
          if (stopRequested) break;
          current = { ...current, scanned: current.scanned + 1 };
          if (await db.messages.get(keyOfHeader(header))) continue;
          batch.push(await headerOnlyRow(header, "inbox"));
          current = { ...current, imported: current.imported + 1 };
          if (batch.length >= BATCH) await flush();
          publish(current);
        }
        current = { ...current, folders: current.folders + 1 };
        publish(current);
      }
      await flush();
      await refreshInboxWindow();
      if (!stopRequested) reached = widest(coveredSince, since);
    }

    // Pass 2: bodies. The phase change is the SPA's cue to load pass 1's rows.
    const todo = stopRequested ? [] : await unreadRows("inbox", since);
    current = { ...current, phase: "bodies", coveredSince: reached, sorted: 0, toSort: todo.length };
    publish(current, true);
    await readAllInFull(todo, "inbox", {
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
      "inbox-import",
      `listed ${current.imported} older inbox messages, read ${current.sorted} of ${current.toSort} in full`,
    );
  } catch (e) {
    await flush().catch(() => undefined);
    log.warn("inbox-import", "import failed", e);
    current = { ...current, running: false, phase: undefined, error: String(e) };
  } finally {
    publish(current, true);
  }
  return current;
};

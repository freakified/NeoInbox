/**
 * The second pass of both imports in Settings → Older mail: reading each
 * header-only row they listed in full, so it is bundled the way scanned mail
 * is. Header rules alone can't tell bulk mail — that's List-Unsubscribe and
 * friends, which only the full message carries — so until a row has been
 * read it can sit in the wrong bundle or none.
 *
 * Only ever started by the user: everything else leaves header-only rows
 * unread (see isHeaderOnly). The rows record whether they were read, so a
 * stopped pass picks up where it left off just by running again.
 */
import { applyClassification } from "../classifier/version";
import { log } from "../shared/log";
import type { RawMessage } from "../shared/types";
import { db } from "../store/db";
import {
  classifyMessage,
  DETAILS_LAZY,
  extractMessageDetails,
  getLiveHeader,
  isHeaderOnly,
  loadMessageBody,
  MESSAGE_DETAILS_VERSION,
} from "./ingest";
import { broadcast } from "./port";
import { BATCH_FLUSH, withTimeout } from "./scanQueue";

type ReadOrigin = "inbox" | "done";

/** Header-only rows of `origin` dated from `since` on, newest first. */
export const unreadRows = async (origin: ReadOrigin, since: number | null): Promise<RawMessage[]> =>
  (await db.messages.where("detailsVersion").equals(DETAILS_LAZY).toArray())
    .filter((m) => m.origin === origin && !m.snoozed && (since === null || m.date >= since))
    .sort((a, b) => b.date - a.date);

/**
 * Reads one header-only row in full and writes back what a scan would have:
 * the category from the full message, and its details — for archived mail,
 * the ones a Done row keeps (no attachment list or parcels, as when inbox
 * mail is archived). Null when the message or its body can't be had, or the
 * row changed meanwhile (archived, restored, snoozed, or reached by the scan).
 */
const readInFull = async (row: RawMessage, origin: ReadOrigin): Promise<RawMessage | null> => {
  const header = await getLiveHeader(row);
  if (!header) return null;
  const body = await loadMessageBody(header.id);
  // Not synced, or the fetch failed: stay header-only, so the next run tries
  // again rather than settling for the header's guess.
  if (body.unavailable) return null;
  const result = await classifyMessage(header, body);
  const details = await extractMessageDetails(
    header.id,
    origin === "inbox" ? { body, parcelsOf: row } : { body, attachments: false },
  );
  return db.transaction("rw", db.messages, async () => {
    const fresh = await db.messages.get(row.key);
    if (!fresh || fresh.origin !== origin || !isHeaderOnly(fresh)) return null;
    const next: RawMessage = {
      ...fresh,
      tbId: header.id,
      references: details.references,
      inReplyTo: details.inReplyTo,
      snippet: details.snippet,
      detailsVersion: MESSAGE_DETAILS_VERSION,
    };
    if (origin === "inbox") {
      next.attachments = details.attachments;
      next.parcels = details.parcels.length ? details.parcels : undefined;
    }
    applyClassification(next, result);
    await db.messages.put(next);
    return next;
  });
};

/**
 * Reads `rows` in full, in order, broadcasting the results as they land so
 * each one moves to its bundle on screen. Stops between rows when asked.
 */
export const readAllInFull = async (
  rows: readonly RawMessage[],
  origin: ReadOrigin,
  { shouldStop, onRead }: { shouldStop: () => boolean; onRead: () => void },
): Promise<void> => {
  let read: RawMessage[] = [];
  const flush = (): void => {
    if (!read.length) return;
    broadcast({ type: "delta", updated: read });
    read = [];
  };
  try {
    for (const row of rows) {
      if (shouldStop()) break;
      try {
        const next = await withTimeout(readInFull(row, origin), `read older message ${row.key}`);
        if (next) {
          read.push(next);
          if (read.length >= BATCH_FLUSH) flush();
        }
      } catch (e) {
        // Left header-only; the next run tries it again.
        log.debug("full-read", "couldn't read a message in full", { key: row.key, e: String(e) });
      }
      onRead();
    }
  } finally {
    flush();
  }
};

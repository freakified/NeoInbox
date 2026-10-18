/**
 * References, In-Reply-To and attachments for cached rows. Inbox rows get them
 * in the background after every scan; Sent and Draft rows only when their
 * conversation is opened, since each one costs a body fetch.
 */
import {
  DETAILS_LAZY,
  extractMessageDetails,
  MESSAGE_DETAILS_VERSION,
  needsMessageDetails,
} from "./ingest";
import { broadcast } from "./port";
import { BATCH_FLUSH, DETAILS_FILL_LIMIT, withTimeout } from "./scanQueue";
import { db } from "../store/db";
import { liveTbId } from "../shared/liveMessage";
import { log } from "../shared/log";
import type { MessageKey } from "../shared/messageKey";
import type { RawMessage } from "../shared/types";

/** Fetches a row's details from its live copy and writes them back. */
const hydrateRow = async (row: RawMessage, label: string): Promise<RawMessage | null> => {
  const tbId = await liveTbId(row);
  if (tbId === null) return null;
  const details = await withTimeout(
    // Only inbox rows keep an attachment list (see the write below), so
    // everything else skips that call rather than fetching and dropping it.
    extractMessageDetails(tbId, { attachments: row.origin === "inbox" }),
    `${label} ${row.key}`,
  );
  return db.transaction("rw", db.messages, async () => {
    const fresh = await db.messages.get(row.key);
    if (!fresh) return null;
    const next: RawMessage = {
      ...fresh,
      tbId,
      attachments: fresh.origin === "inbox" ? details.attachments : [],
      references: details.references,
      inReplyTo: details.inReplyTo,
      snippet: details.snippet,
      detailsVersion: MESSAGE_DETAILS_VERSION,
    };
    await db.messages.put(next);
    return next;
  });
};

let fillingDetails = false;

export const fillMissingDetails = async (limit = DETAILS_FILL_LIMIT): Promise<void> => {
  if (fillingDetails) return;
  fillingDetails = true;
  try {
    // Straight off the detailsVersion index — the unhydrated rows only, not
    // the whole cache filtered down to them. needsMessageDetails still runs as
    // the authority on what counts, over a set that is normally tiny.
    const pending = (
      await db.messages
        .where("detailsVersion")
        .between(DETAILS_LAZY, MESSAGE_DETAILS_VERSION, false, false)
        .toArray()
    )
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
        const row = await hydrateRow(msg, "details for");
        if (row) {
          updated.push(row);
          if (updated.length >= BATCH_FLUSH) flushUpdated();
        }
      } catch (e) {
        log.debug("backfill", "details hydration skipped a message", {
          key: msg.key,
          e: String(e),
        });
      }
    }
    flushUpdated();
  } finally {
    fillingDetails = false;
  }
};

/**
 * Fetches details for specific rows, on demand.
 *
 * This is the other half of DETAILS_LAZY: sent and draft mail is cached from
 * headers alone, and the SPA calls this for the messages in a conversation as
 * it opens. Rows already hydrated cost nothing, so the SPA can call it freely.
 */
export const hydrateDetails = async (messageKeys: readonly MessageKey[]): Promise<void> => {
  const updated: RawMessage[] = [];
  for (const key of messageKeys) {
    const cached = await db.messages.get(key);
    if (!cached) continue;
    if ((cached.detailsVersion ?? 0) >= MESSAGE_DETAILS_VERSION) continue;
    try {
      const row = await hydrateRow(cached, "on-demand details for");
      if (row) updated.push(row);
    } catch (e) {
      log.debug("backfill", "on-demand details fetch failed", { key, e: String(e) });
    }
  }
  if (updated.length) broadcast({ type: "delta", updated });
};

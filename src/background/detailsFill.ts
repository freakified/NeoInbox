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
import { log } from "../shared/log";
import type { RawMessage } from "../shared/types";

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
        const details = await withTimeout(
          // Only inbox rows keep an attachment list (see the write below), so
          // everything else skips that call rather than fetching and dropping it.
          extractMessageDetails(msg.id, { attachments: msg.origin === "inbox" }),
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
            snippet: details.snippet,
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

/**
 * Fetches details for specific rows, on demand.
 *
 * This is the other half of DETAILS_LAZY: sent and draft mail is cached from
 * headers alone, and the SPA calls this for the messages in a conversation as
 * it opens. Rows already hydrated cost nothing, so the SPA can call it freely.
 */
export const hydrateDetails = async (messageIds: readonly number[]): Promise<void> => {
  const updated: RawMessage[] = [];
  for (const id of messageIds) {
    const cached = await db.messages.get(id);
    if (!cached) continue;
    if ((cached.detailsVersion ?? 0) >= MESSAGE_DETAILS_VERSION) continue;
    try {
      const details = await withTimeout(
        extractMessageDetails(id, { attachments: cached.origin === "inbox" }),
        `on-demand details for message ${id}`,
      );
      const row = await db.transaction("rw", db.messages, async () => {
        const fresh = await db.messages.get(id);
        if (!fresh) return null;
        const next: RawMessage = {
          ...fresh,
          attachments: fresh.origin === "inbox" ? details.attachments : [],
          references: details.references,
          inReplyTo: details.inReplyTo,
          snippet: details.snippet,
          detailsVersion: MESSAGE_DETAILS_VERSION,
        };
        await db.messages.put(next);
        return next;
      });
      if (row) updated.push(row);
    } catch (e) {
      log.debug("backfill", "on-demand details fetch failed", { id, e: String(e) });
    }
  }
  if (updated.length) broadcast({ type: "delta", updated });
};

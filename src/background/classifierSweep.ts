/**
 * Keeping cached categories current: the version sweep that carries a rules
 * change to mail already classified, the retry for mail classified before its
 * body was available, and the full reclassify.
 */
import {
  anyIncompleteClassifications,
  applyMessageDetails,
  classifyFromHeader,
  classifyMessage,
  getLiveHeader,
  isHeaderOnly,
  liveHeaderWithinBudget,
  loadMessageBody,
  OVER_BUDGET,
  setIncompleteClassifications,
} from "./ingest";
import { applyClassification, CLASSIFIER_VERSION } from "../classifier/version";
import { applyLocalState } from "./localState";
import { headerToRawMessage } from "./messageMap";
import { broadcast } from "./port";
import { beginScan, endScan, wasRemovedDuringScan } from "./scanGuard";
import {
  BATCH_FLUSH,
  DETAILS_FILL_LIMIT,
  PROGRESS_EVERY,
  sendProgress,
  serialized,
  withTimeout,
} from "./scanQueue";
import { db } from "../store/db";
import { log } from "../shared/log";
import type { MessageOrigin, RawMessage } from "../shared/types";

let reclassifyQueued = false;

const CLASSIFIER_VERSION_KEY = "neoinbox-classifier-version";
/**
 * Rows re-classified per sweep pass. The cache holds every message ever
 * archived (done rows are never pruned), so the backlog runs to tens of
 * thousands and a single pass would hold the scan chain for hours. Progress is
 * durable in the per-row stamps, so the work chunks cleanly.
 */
const VERSION_SWEEP_CHUNK = 500;
/** Breather between passes so scans and live events get the chain back. */
const VERSION_SWEEP_GAP_MS = 5_000;
/**
 * Re-resolutions allowed per pass.
 *
 * A row whose numeric id has drifted can only be found again by Message-ID,
 * and that search walks the account — roughly a second on a large mailbox.
 * Archived rows are the drift-prone population (nothing rescans them), so an
 * uncapped pass over the archive backlog turns into hours of searching that
 * starves both the UI and every other background job. Rows past the cap keep
 * their old stamp and come back on a later pass.
 */
const VERSION_SWEEP_RESOLVE_BUDGET = 25;

let sweepingVersion = false;
let versionSweepTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Outdated rows for one origin, newest first, straight off the
 * [origin+classifierVersion] index — never a full table read.
 */
const outdatedByOrigin = async (
  origin: MessageOrigin,
  limit: number,
): Promise<{ total: number; rows: RawMessage[] }> => {
  const range = db.messages
    .where("[origin+classifierVersion]")
    .between([origin, -Infinity], [origin, CLASSIFIER_VERSION], true, false);
  const total = await range.count();
  if (!total || limit <= 0) return { total, rows: [] };
  const rows = await range.limit(limit).toArray();
  rows.sort((a, b) => b.date - a.date);
  return { total, rows };
};

/**
 * Inbox only. Done rows used to be swept too, which meant every bump of
 * CLASSIFIER_VERSION re-fetched the body of every archived message NeoInbox
 * had ever cached — the comment on VERSION_SWEEP_CHUNK still describes that
 * backlog running to tens of thousands. Archived mail keeps whatever category
 * it had when you pressed Done; it is not on screen and not worth a download.
 */
const outdatedRows = async (limit: number): Promise<{ total: number; chunk: RawMessage[] }> => {
  const inbox = await outdatedByOrigin("inbox", limit);
  return { total: inbox.total, chunk: inbox.rows };
};

/**
 * Re-classifies one chunk of cached rows whose category predates the current
 * rules, newest inbox mail first. Returns how many remain afterwards.
 *
 * Scans reuse a cached row's category rather than re-running the pipeline, so
 * this sweep is the only thing that carries a classifier change to mail that
 * is already cached. Without it a rules change reaches newly arriving mail
 * only, and the existing inbox keeps its old categories until someone presses
 * "Reclassify inbox" by hand.
 *
 * Each row is stamped as it is written, so an interrupted run resumes where it
 * stopped; the stored version only advances once a pass finds nothing left.
 */
export const runClassifierVersionSweep = async (): Promise<{
  scanned: number;
  moved: number;
  remaining: number;
}> => {
  const idle = { scanned: 0, moved: 0, remaining: 0 };
  if (sweepingVersion) return idle;
  const stored = await messenger.storage.local.get(CLASSIFIER_VERSION_KEY);
  const previous = Number(stored[CLASSIFIER_VERSION_KEY] ?? 0);
  // Any difference, not just a lower stored version: storage.local outlives a
  // dropped IndexedDB, so a stamp left by an older numbering would otherwise
  // suppress every sweep until the counter climbed back past it.
  if (previous === CLASSIFIER_VERSION) return idle;
  sweepingVersion = true;
  // Serialized with scans: the sweep writes the same rows a scan batches, and
  // interleaving the two would let a stale batch overwrite a fresh category.
  return serialized(async () => {
    beginScan();
    let scanned = 0;
    let moved = 0;
    let remaining = 0;
    let drained = false;
    try {
      const { total, chunk } = await outdatedRows(VERSION_SWEEP_CHUNK);
      if (!total) {
        drained = true;
        return idle;
      }
      log.info(
        "backfill",
        `classifier ${previous} -> ${CLASSIFIER_VERSION}: reclassifying ${chunk.length} of ${total} cached messages`,
      );
      let updated: RawMessage[] = [];
      const flushUpdated = (): void => {
        if (!updated.length) return;
        broadcast({ type: "delta", updated });
        updated = [];
      };
      let resolveBudget = VERSION_SWEEP_RESOLVE_BUDGET;
      let deferred = 0;
      let retired = 0;
      for (const msg of chunk) {
        scanned++;
        try {
          const header = await withTimeout(
            liveHeaderWithinBudget(msg, () => resolveBudget > 0 && resolveBudget-- > 0),
            `version sweep message ${msg.key}`,
          );
          if (header === OVER_BUDGET) {
            // Left outdated on purpose: it comes back on a later pass rather
            // than spending a search now. Not counted as scanned work.
            deferred++;
            scanned--;
            continue;
          }
          // A row we spent budget on and still couldn't find keeps its category
          // but takes the current stamp anyway. Leaving it outdated would put
          // it at the front of every later pass, spending the budget again and
          // never draining — the sweep would run forever.
          const result = !header
            ? { category: msg.category, incomplete: msg.classifiedIncomplete ?? false }
            : isHeaderOnly(msg)
              ? await classifyFromHeader(header)
              : await classifyMessage(header);
          const row = await db.transaction("rw", db.messages, async () => {
            const fresh = await db.messages.get(msg.key);
            if (!fresh) return null;
            // Keep the id the search found, so it is spent once rather than
            // again on every later touch of this row this session.
            const next: RawMessage = { ...fresh, tbId: header?.id ?? fresh.tbId };
            applyClassification(next, result);
            await db.messages.put(next);
            return next;
          });
          if (row) {
            retired++;
            if ((row.category ?? null) !== (msg.category ?? null)) moved++;
            updated.push(row);
            if (updated.length >= BATCH_FLUSH) flushUpdated();
          }
        } catch (e) {
          log.debug("backfill", "version sweep skipped a message", {
            key: msg.key,
            e: String(e),
          });
        }
      }
      flushUpdated();
      if (deferred) {
        log.info(
          "backfill",
          `version sweep deferred ${deferred} rows with drifted ids (budget ${VERSION_SWEEP_RESOLVE_BUDGET}/pass)`,
        );
      }
      // Measured by what actually left the outdated set, not by chunk size:
      // rows deferred for budget are still outstanding and must bring the
      // driver back. Every pass retires at least the non-drifted rows plus the
      // budget, so this always converges.
      remaining = Math.max(total - retired, 0);
      drained = remaining === 0;
      if (retired === 0 && total > 0) {
        // Nothing could be retired at all — every row threw. Stop rather than
        // spin, but don't claim the version: the next background start retries.
        log.warn("backfill", `version sweep made no progress on ${total} rows; stopping`);
        remaining = 0;
      }
      log.info(
        "backfill",
        `version sweep pass: ${moved}/${scanned} changed category, ${remaining} left`,
      );
      return { scanned, moved, remaining };
    } catch (e) {
      log.error("backfill", "version sweep failed", e);
      return { scanned, moved, remaining };
    } finally {
      endScan();
      sweepingVersion = false;
      // Claim the new version only once a pass finds nothing outdated left.
      if (drained) {
        await messenger.storage.local
          .set({ [CLASSIFIER_VERSION_KEY]: CLASSIFIER_VERSION })
          .catch((e) => log.warn("backfill", "storing classifier version failed", e));
        log.info("backfill", `classifier version ${CLASSIFIER_VERSION} fully applied`);
      }
    }
  });
};

/**
 * Drives the version sweep to completion a chunk at a time, yielding the scan
 * chain between passes. Deliberately silent on the progress channel: this runs
 * for as long as the backlog takes and must not pin the UI's progress bar —
 * the per-chunk deltas re-bundle rows on screen as they land.
 */
export const startClassifierVersionSweep = (): void => {
  clearTimeout(versionSweepTimer);
  void runClassifierVersionSweep()
    .then(({ remaining }) => {
      if (remaining <= 0) return;
      versionSweepTimer = setTimeout(startClassifierVersionSweep, VERSION_SWEEP_GAP_MS);
    })
    .catch((e) => log.warn("backfill", "classifier version sweep failed", e));
};

let retryingClassifications = false;

/**
 * Re-attempts classification for inbox rows whose category was decided
 * without the full message body (classifyMessage's getFull() call failed).
 * Runs alongside fillMissingDetails after every scan; rows that still fail
 * getFull() keep the flag and are retried on the next sweep.
 *
 * Inbox only — retrying done rows would fetch bodies out of the archive.
 */
export const retryIncompleteClassifications = async (limit = DETAILS_FILL_LIMIT): Promise<void> => {
  if (retryingClassifications) return;
  // The rows this wants can't be reached by index (see
  // anyIncompleteClassifications), so the read below is a full one. Gate it on
  // whether anything was ever classified without a body, or every scan pays
  // for a read of the whole cache to learn there is nothing to do.
  if (!(await anyIncompleteClassifications())) return;
  retryingClassifications = true;
  try {
    // Header-only rows are incomplete by design, not because a fetch failed;
    // retrying them would download the older inbox a pass at a time.
    const matching = (await db.messages.toArray()).filter(
      (m) => m.origin === "inbox" && m.classifiedIncomplete && !isHeaderOnly(m),
    );
    const pending = matching.slice(0, limit);
    // Anything past this pass's limit, plus anything the pass fails to fix,
    // keeps the flag set so a later scan tries again.
    let stillIncomplete = matching.length - pending.length;
    if (!pending.length) {
      await setIncompleteClassifications(false);
      return;
    }
    log.info("backfill", `retrying classification for ${pending.length} messages`);
    let updated: RawMessage[] = [];
    const flushUpdated = (): void => {
      if (!updated.length) return;
      broadcast({ type: "delta", updated });
      updated = [];
    };
    for (const msg of pending) {
      try {
        const header = await withTimeout(
          getLiveHeader(msg),
          `retry classify message ${msg.key}`,
        );
        if (!header) {
          stillIncomplete++;
          continue;
        }
        const { category, incomplete } = await classifyMessage(header);
        if (incomplete) {
          stillIncomplete++;
          continue;
        }
        const row = await db.transaction("rw", db.messages, async () => {
          const fresh = await db.messages.get(msg.key);
          if (!fresh) return null;
          const next: RawMessage = {
            ...fresh,
            tbId: header.id,
            category,
            classifiedIncomplete: false,
            classifierVersion: CLASSIFIER_VERSION,
          };
          await db.messages.put(next);
          return next;
        });
        if (row) {
          updated.push(row);
          if (updated.length >= BATCH_FLUSH) flushUpdated();
        }
      } catch (e) {
        stillIncomplete++;
        log.debug("backfill", "classification retry skipped a message", {
          key: msg.key,
          e: String(e),
        });
      }
    }
    flushUpdated();
    if (stillIncomplete === 0) await setIncompleteClassifications(false);
  } finally {
    retryingClassifications = false;
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
        const rows = batch.filter((m) => !wasRemovedDuringScan(m.key));
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
            getLiveHeader(cachedMsg),
            `reclassify message ${cachedMsg.key}`,
          );
          if (!header) continue;
          const headerOnly = isHeaderOnly(cachedMsg);
          const body = headerOnly ? undefined : await loadMessageBody(header.id);
          const result = headerOnly
            ? await classifyFromHeader(header)
            : await classifyMessage(header, body);
          if (result.category !== cachedMsg.category) updated++;
          const raw = headerToRawMessage(header, "inbox");
          applyClassification(raw, result);
          await applyLocalState(raw);
          await applyMessageDetails(raw, cachedMsg, body);
          // The live copy sits in another folder than the row said: that
          // row is the new copy's now.
          if (raw.key !== cachedMsg.key) {
            await db.messages.delete(cachedMsg.key);
            broadcast({ type: "delta", removedKeys: [cachedMsg.key] });
          }
          batch.push(raw);
          if (batch.length >= BATCH_FLUSH) await flush();
        } catch (e) {
          log.warn("reclassify", "skipping message after per-message failure", {
            key: cachedMsg.key,
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

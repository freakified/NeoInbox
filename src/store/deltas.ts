import { isHistory } from "./history";
import type { StoreGet, StoreSet } from "./storeTypes";
import type { MessageKey } from "../shared/messageKey";
import type { Delta, RawMessage } from "../shared/types";

/**
 * Deltas are buffered and applied as one store write instead of one write
 * each.
 *
 * A scan broadcasts a delta every hundred rows, and each write replaces
 * messagesByKey — which invalidates the stream memo and costs a full re-thread
 * (buildThreads unions every visible message) plus a re-render. A large
 * mailbox paid for that a hundred times over while it synced. The flush lands
 * on a timer, so deltas arriving faster than the event loop drains collapse
 * into a single update, while an isolated delta still applies on the next tick.
 */
const REMOVED = Symbol("removed");
type BufferedRow = RawMessage | typeof REMOVED;

let pendingRows: Map<MessageKey, BufferedRow> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Applies the buffered deltas now.
 *
 * Every optimistic mutation calls this first. Without it, a delta queued in
 * one turn and a click in the next would race: the flush would overwrite the
 * row the click just changed with a copy that predates it, and the action
 * would visibly revert until the next delta corrected it.
 */
export const flushDelta = (
  set: StoreSet,
  get: StoreGet,
): void => {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const rows = pendingRows;
  pendingRows = null;
  if (!rows?.size) return;

  const map = { ...get().messagesByKey };
  const snoozesByKey = { ...get().snoozesByKey };
  const pending = { ...get().pendingOps };
  let pendingChanged = false;

  const { historyFrom } = get();
  for (const [key, row] of rows) {
    // A background sweep touching old Sent or Done mail that was never paged
    // in (details, a reclassify) must not pull it into memory one row at a
    // time; it loads with its page like the rest.
    if (row !== REMOVED && !(key in map) && isHistory(row) && row.date < historyFrom) {
      continue;
    }
    if (row === REMOVED) {
      delete map[key];
      delete snoozesByKey[key];
    } else {
      map[key] = row;
      // A message that comes back unsnoozed has woken; drop any stale record.
      if (snoozesByKey[key] && !row.snoozed) delete snoozesByKey[key];
    }
    // Any delta naming a message settles the optimistic op waiting on it.
    if (key in pending) {
      delete pending[key];
      pendingChanged = true;
    }
  }

  set({
    messagesByKey: map,
    snoozesByKey,
    ...(pendingChanged ? { pendingOps: pending } : {}),
  });
};

/** Queue one delta's rows for the next flush. */
export const bufferDelta = (set: StoreSet, get: StoreGet, msg: Delta): void => {
  // Last write per key wins, which is what applying the deltas in arrival
  // order would produce: a row added then removed ends up removed, and a
  // row removed then re-added ends up present.
  const rows = (pendingRows ??= new Map());
  if (msg.added) for (const m of msg.added) rows.set(m.key, m);
  if (msg.updated) for (const m of msg.updated) rows.set(m.key, m);
  if (msg.removedKeys) for (const key of msg.removedKeys) rows.set(key, REMOVED);
  if (flushTimer === null) {
    flushTimer = setTimeout(() => flushDelta(set, get), 0);
  }
};

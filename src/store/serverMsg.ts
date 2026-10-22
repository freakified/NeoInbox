import { bufferDelta, flushDelta } from "./deltas";
import { PENDING_REPLY_TIMEOUT_MS, pendingCompose, pendingReplyTimers } from "./composeSlice";
import type { StoreGet, StoreSet, ToastRecord } from "./storeTypes";
import { failureLabel, nextToastId, TOAST_LIMIT } from "./toastsSlice";
import { loadTripMembers } from "./history";
import { log } from "../shared/log";
import type { ServerMsg } from "../shared/messaging";
import { pinKeyOf } from "../shared/pinKey";
import type { TripMembershipRecord } from "../shared/types";

/**
 * A trip the clusterer just grew may now hold Done mail older than the
 * loaded history; page those rows in so the trip shows all of its mail.
 */
const loadMissingTripMembers = async (
  set: StoreSet,
  get: StoreGet,
  memberships: readonly TripMembershipRecord[],
): Promise<void> => {
  const loaded = new Set(Object.values(get().messagesByKey).map(pinKeyOf));
  const missing = memberships.filter((m) => m.tripId && !loaded.has(m.key));
  if (!missing.length) return;
  const rows = await loadTripMembers(missing);
  if (!rows.length) return;
  const map = { ...get().messagesByKey };
  for (const m of rows) map[m.key] ??= m;
  set({ messagesByKey: map });
};

const SCAN_TOAST_ID = "scan-progress";

/**
 * One toast tracks a running full scan, rewritten in place as progress lands
 * so it keeps its spot in the stack, and dropped once the scan ends.
 */
const withScanToast = (
  toasts: ToastRecord[],
  msg: Extract<ServerMsg, { type: "backfill-progress" }>,
): ToastRecord[] => {
  if (msg.done) return toasts.filter((t) => t.id !== SCAN_TOAST_ID);
  const toast: ToastRecord = {
    id: SCAN_TOAST_ID,
    message: `Scanning… ${msg.scanned} messages, ${msg.classified} classified`,
    progress: true,
  };
  if (toasts.some((t) => t.id === SCAN_TOAST_ID)) {
    return toasts.map((t) => (t.id === SCAN_TOAST_ID ? toast : t));
  }
  return [...toasts, toast].slice(-TOAST_LIMIT);
};

export const applyServerMsg = (
  set: StoreSet,
  get: StoreGet,
  msg: ServerMsg,
): void => {
  switch (msg.type) {
    case "delta":
      bufferDelta(set, get, msg);
      return;
    case "myEmails":
      set({ myEmails: new Set(msg.emails) });
      return;
    case "backfill-progress":
      set({
        syncProgress: {
          scanned: msg.scanned,
          classified: msg.classified,
          done: msg.done,
          error: msg.error ?? null,
        },
        toasts: withScanToast(get().toasts, msg),
      });
      return;
    case "inbox-window":
      set({
        inboxWindow: { cap: msg.cap, skipped: msg.skipped },
      });
      return;
    case "command-failed": {
      // The rollback restores the pre-op row, so it must land after any delta
      // still buffered for that message rather than be overwritten by it.
      flushDelta(set, get);
      const pending = { ...get().pendingOps };
      const op = pending[msg.messageKey];
      const map = { ...get().messagesByKey };
      if (op) {
        map[msg.messageKey] = op.message;
        delete pending[msg.messageKey];
      }
      const wakeAt = op?.kind === "snooze" ? op.wakeAt : undefined;
      const snoozesByKey = { ...get().snoozesByKey };
      if (msg.command === "snooze") delete snoozesByKey[msg.messageKey];
      if (msg.command === "unsnooze" && op?.kind === "unsnooze" && op.snooze) {
        snoozesByKey[msg.messageKey] = op.snooze;
      }
      const toast: ToastRecord = {
        id: nextToastId(),
        message: `${failureLabel(msg.command)} — ${msg.reason}`,
        retry: { kind: msg.command, messageKey: msg.messageKey, wakeAt },
      };
      const toasts = [...get().toasts, toast].slice(-TOAST_LIMIT);
      set({ messagesByKey: map, pendingOps: pending, snoozesByKey, toasts });
      log.warn("store", "command failed", msg);
      return;
    }
    case "reclassify-done": {
      const message =
        msg.moved === 0
          ? `Checked ${msg.scanned} ${msg.scanned === 1 ? "message" : "messages"} — everything already in place`
          : `Checked ${msg.scanned} ${msg.scanned === 1 ? "message" : "messages"} — ${msg.moved} moved`;
      const toast: ToastRecord = { id: nextToastId(), message };
      set({ reclassifying: false, toasts: [...get().toasts, toast].slice(-TOAST_LIMIT) });
      return;
    }
    case "backup-imported": {
      if (msg.error) {
        const toast: ToastRecord = { id: nextToastId(), message: `Couldn't import — ${msg.error}` };
        set({ importingBackup: false, toasts: [...get().toasts, toast].slice(-TOAST_LIMIT) });
        return;
      }
      // Bundles, rules, reminders and page settings all changed at once;
      // starting over reads them fresh rather than patching each slice.
      location.reload();
      return;
    }
    case "compose-result": {
      const toastId = pendingCompose.get(msg.requestId);
      pendingCompose.delete(msg.requestId);
      const toasts = get().toasts.filter((t) => t.id !== toastId);
      const message =
        msg.outcome === "sent"
          ? "Message sent"
          : msg.outcome === "failed"
            ? `Couldn't send${msg.error ? ` — ${msg.error}` : ""}. It's still open in Thunderbird.`
            : null;
      if (message) toasts.push({ id: nextToastId(), message });
      // A failed send is still open in Thunderbird, so its preview goes; a
      // sent one stays until its Sent copy replaces it.
      const pendingReplies =
        msg.outcome === "sent"
          ? get().pendingReplies.map((r) =>
              r.requestId === msg.requestId ? { ...r, status: "sent" as const } : r,
            )
          : get().pendingReplies.filter((r) => r.requestId !== msg.requestId);
      if (msg.outcome === "sent" && pendingReplies.some((r) => r.requestId === msg.requestId)) {
        pendingReplyTimers.set(
          msg.requestId,
          setTimeout(() => get().settlePendingReply(msg.requestId), PENDING_REPLY_TIMEOUT_MS),
        );
      }
      set({ toasts: toasts.slice(-TOAST_LIMIT), pendingReplies });
      return;
    }
    case "trip-scan-progress": {
      const { type: _type, ...status } = msg;
      const wasRunning = get().tripScan?.running;
      set({ tripScan: status });
      // A restarted background answers hello with the last *stored* scan;
      // only a run that just ended deserves a toast.
      const justEnded = status.error !== undefined || Date.now() - (status.finishedAt ?? 0) < 60_000;
      if (wasRunning && !status.running && justEnded) {
        const trips = `${(status.trips ?? 0).toLocaleString()} ${status.trips === 1 ? "trip" : "trips"}`;
        // An archive scan that isn't a rebuild is Settings → Older mail: its
        // import half stays quiet and this one toast speaks for both.
        const message = status.archive && !status.rebuild
          ? status.error
            ? "Couldn't finish loading older mail"
            : status.cancelled
              ? "Stopped loading older mail"
              : `Older mail loaded — ${trips}`
          : status.error
            ? "Couldn't finish looking for trips"
            : status.cancelled
              ? `Stopped looking for trips after ${status.processed.toLocaleString()} ${status.processed === 1 ? "message" : "messages"}`
              : `Trip scan done — ${trips}`;
        set({ toasts: [...get().toasts, { id: nextToastId(), message }].slice(-TOAST_LIMIT) });
      }
      return;
    }
    case "archive-import-progress": {
      const { type: _type, ...status } = msg;
      const previous = get().archiveImport;
      const wasRunning = previous?.running;
      set({ archiveImport: status });
      // The header pass writes its rows without deltas; show them all at once
      // when it ends. The read pass that follows sends deltas as it goes.
      const listed = previous?.phase === "headers" && status.phase !== "headers";
      if (wasRunning && (listed || !status.running)) void get().reloadHistory();
      // During a load from Older mail the trip scan's toast covers this.
      if (wasRunning && !status.running && !get().tripScan?.running) {
        const done = Math.max(status.imported, status.sorted ?? 0);
        const count = `${done.toLocaleString()} ${done === 1 ? "message" : "messages"}`;
        const message = status.error
          ? "Couldn't finish loading older mail"
          : status.cancelled
            ? "Stopped loading older mail"
            : done === 0
              ? "No new older mail to load"
              : `Loaded ${count} of older mail`;
        set({ toasts: [...get().toasts, { id: nextToastId(), message }].slice(-TOAST_LIMIT) });
      }
      return;
    }
    case "inbox-import-progress": {
      const { type: _type, ...status } = msg;
      const previous = get().inboxImport;
      const wasRunning = previous?.running;
      set({ inboxImport: status });
      // The header pass writes its rows without deltas; show them all at once
      // when it ends. The body pass that follows sends deltas as it goes.
      const listed = previous?.phase === "headers" && status.phase !== "headers";
      if (wasRunning && (listed || !status.running)) void get().reloadInbox();
      // Started from Older mail, the trip scan that follows has its own toast.
      if (wasRunning && !status.running && !get().tripScan?.running) {
        const done = Math.max(status.imported, status.sorted ?? 0);
        const count = `${done.toLocaleString()} ${done === 1 ? "message" : "messages"}`;
        const message = status.error
          ? "Couldn't finish loading older inbox mail"
          : status.cancelled
            ? "Stopped loading older inbox mail"
            : done === 0
              ? "No older inbox mail to load"
              : `Loaded ${count} of older inbox mail`;
        set({ toasts: [...get().toasts, { id: nextToastId(), message }].slice(-TOAST_LIMIT) });
      }
      return;
    }
    case "trips-delta": {
      // Already persisted to Dexie. Merge into the store, but a manual
      // membership made here always beats an incoming auto row for the same
      // key — the clusterer read our state before this user action landed.
      // An authoritative delta is what the database now holds, manual rows
      // included (another tab's edit, or our own echoed back).
      const tripsById = { ...get().tripsById };
      for (const id of msg.removedTripIds) delete tripsById[id];
      for (const trip of msg.trips) tripsById[trip.id] = trip;
      const membershipByKey = { ...get().tripMembershipByKey };
      const keepManual = (key: string): boolean =>
        !msg.authoritative && membershipByKey[key]?.source === "manual";
      for (const key of msg.removedMembershipKeys) {
        if (keepManual(key)) continue;
        delete membershipByKey[key];
      }
      for (const m of msg.memberships) {
        if (keepManual(m.key)) continue;
        membershipByKey[m.key] = m;
      }
      set({ tripsById, tripMembershipByKey: membershipByKey });
      if (get().historyFrom) void loadMissingTripMembers(set, get, msg.memberships);
      return;
    }
    case "error":
      log.warn("store", "server error", msg.message);
      return;
  }
}


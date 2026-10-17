import { flushDelta } from "./deltas";
import { send } from "./portClient";
import type { MailStore, StoreGet, StoreSet, ToastRecord } from "./storeTypes";
import {
  commitUndoToast,
  doneToastMessage,
  nextToastId,
  TOAST_LIMIT,
  trashToastMessage,
  UNDO_TIMEOUT_MS,
  undoTimers,
} from "./toastsSlice";
import { MESSAGE_DETAILS_VERSION } from "../shared/details";
import { log } from "../shared/log";

export const mailSlice = (
  set: StoreSet,
  get: StoreGet,
): Pick<
  MailStore,
  "pin" | "doneThread" | "snoozeThread" | "unsnoozeThread" | "trashThread" | "moveToInboxThread" | "setRouteRule" | "deleteRouteRule" | "applyCategoryLocally" | "setCustomBundle" | "deleteCustomBundle" | "healStaleMessage" | "hydrateThreadDetails" | "loadMoreInbox" | "retryBackfill" | "openBundleSettings" | "closeBundleSettings" | "reclassify"
> => ({
  pin: (messageId, pinned) => {
    flushDelta(set, get);
    const map = { ...get().messagesById };
    const m = map[messageId];
    if (m) {
      map[messageId] = { ...m, pinned };
      set({ messagesById: map });
    }
    send({ type: "pin", messageId, pinned });
  },
  doneThread: (messageIds) => {
    if (messageIds.length === 0) return;
    flushDelta(set, get);
    const prev = get().messagesById;
    const map = { ...prev };
    const pending = { ...get().pendingOps };
    for (const id of messageIds) {
      const m = prev[id];
      if (!m) continue;
      pending[id] = { kind: "done", message: m };
      // Flip to done rather than delete: the row leaves the inbox instantly
      // but stays visible in done/bundle/trip views while the archive (which
      // waits out the undo toast, then an IMAP round-trip) catches up.
      map[id] = { ...m, origin: "done" };
    }
    const toastId = nextToastId();
    const toast: ToastRecord = {
      id: toastId,
      message: doneToastMessage(messageIds.length),
      undo: { messageIds, kind: "done" },
    };
    const allToasts = [...get().toasts, toast];
    const newToasts = allToasts.slice(-TOAST_LIMIT);
    for (const dropped of allToasts.slice(0, allToasts.length - TOAST_LIMIT)) {
      if (dropped.undo) commitUndoToast(get, set, dropped.id);
    }
    set({ messagesById: map, pendingOps: pending, toasts: newToasts });
    const timer = setTimeout(() => commitUndoToast(get, set, toastId), UNDO_TIMEOUT_MS);
    undoTimers.set(toastId, timer);
  },
  snoozeThread: (messageIds, wakeAt) => {
    if (messageIds.length === 0) return;
    flushDelta(set, get);
    const prev = get().messagesById;
    const map = { ...prev };
    const pending = { ...get().pendingOps };
    for (const id of messageIds) {
      const m = prev[id];
      if (m) pending[id] = { kind: "snooze", message: m, wakeAt };
      if (m) {
        map[id] = { ...m, snoozed: true, origin: "inbox" };
      }
    }
    const snoozesByMessageId = { ...get().snoozesByMessageId };
    for (const id of messageIds) {
      const m = prev[id];
      if (!m) continue;
      snoozesByMessageId[id] = {
        messageId: id,
        wakeAt,
        originFolderId: m.folderId,
        originAccountId: m.accountId,
        headerMessageId: m.headerMessageId,
      };
    }
    set({ messagesById: map, pendingOps: pending, snoozesByMessageId });
    for (const id of messageIds) send({ type: "snooze", messageId: id, wakeAt });
  },
  unsnoozeThread: (messageIds) => {
    if (messageIds.length === 0) return;
    flushDelta(set, get);
    const prev = get().messagesById;
    const map = { ...prev };
    const pending = { ...get().pendingOps };
    const snoozesByMessageId = { ...get().snoozesByMessageId };
    const now = Date.now();
    for (const id of messageIds) {
      const m = prev[id];
      if (!m) continue;
      pending[id] = { kind: "unsnooze", message: m, snooze: snoozesByMessageId[id] };
      map[id] = { ...m, snoozed: false, resurfacedAt: now, snoozeExpired: false };
      delete snoozesByMessageId[id];
    }
    set({ messagesById: map, pendingOps: pending, snoozesByMessageId });
    for (const id of messageIds) send({ type: "unsnooze", messageId: id });
  },
  trashThread: (messageIds) => {
    if (messageIds.length === 0) return;
    flushDelta(set, get);
    const prev = get().messagesById;
    const map = { ...prev };
    const pending = { ...get().pendingOps };
    for (const id of messageIds) {
      const m = prev[id];
      if (m) pending[id] = { kind: "trash", message: m };
      delete map[id];
    }
    const toastId = nextToastId();
    const toast: ToastRecord = {
      id: toastId,
      message: trashToastMessage(messageIds.length),
      undo: { messageIds, kind: "trash" },
    };
    const allToasts = [...get().toasts, toast];
    const newToasts = allToasts.slice(-TOAST_LIMIT);
    for (const dropped of allToasts.slice(0, allToasts.length - TOAST_LIMIT)) {
      if (dropped.undo) commitUndoToast(get, set, dropped.id);
    }
    set({ messagesById: map, pendingOps: pending, toasts: newToasts });
    const timer = setTimeout(() => commitUndoToast(get, set, toastId), UNDO_TIMEOUT_MS);
    undoTimers.set(toastId, timer);
  },
  moveToInboxThread: (messageIds) => {
    if (messageIds.length === 0) return;
    flushDelta(set, get);
    const prev = get().messagesById;
    const map = { ...prev };
    const pending = { ...get().pendingOps };
    for (const id of messageIds) {
      const m = prev[id];
      if (!m) continue;
      pending[id] = { kind: "moveToInbox", message: m };
      map[id] = { ...m, origin: "inbox" };
    }
    set({ messagesById: map, pendingOps: pending });
    for (const id of messageIds) send({ type: "move-to-inbox", messageId: id });
  },
  setRouteRule: (rule) => {
    // Mirror the background's invariant: one destination per (type, value) key.
    const rules = get().routeRules.filter(
      (r) => r.id !== rule.id && !(r.type === rule.type && r.value === rule.value),
    );
    rules.push(rule);
    set({ routeRules: rules });
    send({ type: "set-route-rule", rule });
  },
  deleteRouteRule: (id) => {
    set({ routeRules: get().routeRules.filter((r) => r.id !== id) });
    send({ type: "delete-route-rule", id });
  },
  applyCategoryLocally: (messageIds, category) => {
    flushDelta(set, get);
    const map = { ...get().messagesById };
    for (const id of messageIds) {
      const m = map[id];
      if (m) map[id] = { ...m, category };
    }
    set({ messagesById: map });
  },
  setCustomBundle: (bundle) => {
    const bundles = get().customBundles.filter((b) => b.id !== bundle.id);
    bundles.push(bundle);
    bundles.sort((a, b) => a.order - b.order);
    set({ customBundles: bundles });
    send({ type: "set-custom-bundle", bundle });
  },
  deleteCustomBundle: (id) => {
    set({
      customBundles: get().customBundles.filter((b) => b.id !== id),
      routeRules: get().routeRules.filter((r) => r.target !== id),
    });
    send({ type: "delete-custom-bundle", id });
  },
  healStaleMessage: (staleId, liveId) => {
    flushDelta(set, get);
    const map = { ...get().messagesById };
    const stale = map[staleId];
    if (!stale) return false;
    // A snoozed row is keyed by its snooze record, not by where the message
    // is parked; re-keying it would orphan it from Snoozed and from waking.
    if (stale.snoozed) return false;
    delete map[staleId];
    if (!map[liveId]) map[liveId] = { ...stale, id: liveId };
    send({ type: "heal-message", staleId, liveId });
    log.info("store", "healed stale message id", { staleId, liveId });
    set({ messagesById: map });
    return true;
  },
  hydrateThreadDetails: (messageIds) => {
    // Sent and draft rows are cached from headers alone so nothing downloads
    // them in the background; opening the conversation is what asks for them.
    // The background skips ids it has already hydrated, so this is cheap to
    // fire on every open.
    const pending = messageIds.filter((id) => {
      const m = get().messagesById[id];
      return m && (m.detailsVersion ?? 0) < MESSAGE_DETAILS_VERSION;
    });
    if (pending.length) send({ type: "hydrate-details", messageIds: pending });
  },
  loadMoreInbox: () => {
    if (get().loadingMoreInbox) return;
    set({ loadingMoreInbox: true });
    send({ type: "load-more-inbox" });
  },
  retryBackfill: () => {
    const prev = get().syncProgress;
    set({
      syncProgress: prev
        ? { ...prev, done: false, error: null }
        : { scanned: 0, classified: 0, done: false, error: null },
    });
    send({ type: "retry-backfill" });
  },
  openBundleSettings: (request) => {
    set({ bundleSettings: request });
  },
  closeBundleSettings: () => {
    set({ bundleSettings: null });
  },
  reclassify: (messageIds) => {
    if (get().reclassifying) return;
    set({ reclassifying: true });
    send({ type: "reclassify", messageIds });
  },
});

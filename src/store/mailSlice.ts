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

export const mailSlice = (
  set: StoreSet,
  get: StoreGet,
): Pick<
  MailStore,
  "pin" | "doneThread" | "snoozeThread" | "unsnoozeThread" | "trashThread" | "moveToInboxThread" | "setRouteRule" | "deleteRouteRule" | "applyCategoryLocally" | "setCustomBundle" | "deleteCustomBundle" | "hydrateThreadDetails" | "markThreadRead" | "retryBackfill" | "openBundleSettings" | "closeBundleSettings" | "reclassify" | "importArchive" | "stopArchiveImport"
> => ({
  pin: (messageKey, pinned) => {
    flushDelta(set, get);
    const map = { ...get().messagesByKey };
    const m = map[messageKey];
    if (m) {
      map[messageKey] = { ...m, pinned };
      set({ messagesByKey: map });
    }
    send({ type: "pin", messageKey, pinned });
  },
  doneThread: (messageKeys) => {
    if (messageKeys.length === 0) return;
    flushDelta(set, get);
    const prev = get().messagesByKey;
    const map = { ...prev };
    const pending = { ...get().pendingOps };
    for (const key of messageKeys) {
      const m = prev[key];
      if (!m) continue;
      pending[key] = { kind: "done", message: m };
      // Flip to done rather than delete: the row leaves the inbox instantly
      // but stays visible in done/bundle/trip views while the archive (which
      // waits out the undo toast, then an IMAP round-trip) catches up.
      map[key] = { ...m, origin: "done" };
    }
    const toastId = nextToastId();
    const toast: ToastRecord = {
      id: toastId,
      message: doneToastMessage(messageKeys.length),
      undo: { messageKeys, kind: "done" },
    };
    const allToasts = [...get().toasts, toast];
    const newToasts = allToasts.slice(-TOAST_LIMIT);
    for (const dropped of allToasts.slice(0, allToasts.length - TOAST_LIMIT)) {
      if (dropped.undo) commitUndoToast(get, set, dropped.id);
    }
    set({ messagesByKey: map, pendingOps: pending, toasts: newToasts });
    const timer = setTimeout(() => commitUndoToast(get, set, toastId), UNDO_TIMEOUT_MS);
    undoTimers.set(toastId, timer);
  },
  snoozeThread: (messageKeys, wakeAt) => {
    if (messageKeys.length === 0) return;
    flushDelta(set, get);
    const prev = get().messagesByKey;
    const map = { ...prev };
    const pending = { ...get().pendingOps };
    for (const key of messageKeys) {
      const m = prev[key];
      if (m) pending[key] = { kind: "snooze", message: m, wakeAt };
      if (m) {
        map[key] = { ...m, snoozed: true, origin: "inbox" };
      }
    }
    const snoozesByKey = { ...get().snoozesByKey };
    for (const key of messageKeys) {
      const m = prev[key];
      if (!m) continue;
      snoozesByKey[key] = {
        messageKey: key,
        wakeAt,
        originFolderId: m.folderId,
        originAccountId: m.accountId,
        headerMessageId: m.headerMessageId,
      };
    }
    set({ messagesByKey: map, pendingOps: pending, snoozesByKey });
    for (const key of messageKeys) send({ type: "snooze", messageKey: key, wakeAt });
  },
  unsnoozeThread: (messageKeys) => {
    if (messageKeys.length === 0) return;
    flushDelta(set, get);
    const prev = get().messagesByKey;
    const map = { ...prev };
    const pending = { ...get().pendingOps };
    const snoozesByKey = { ...get().snoozesByKey };
    for (const key of messageKeys) {
      const m = prev[key];
      if (!m) continue;
      pending[key] = { kind: "unsnooze", message: m, snooze: snoozesByKey[key] };
      // Back at its own date, as if never snoozed (only an alarm wake moves it).
      const { resurfacedAt: _resurfacedAt, snoozeExpired: _snoozeExpired, ...rest } = m;
      map[key] = { ...rest, snoozed: false };
      delete snoozesByKey[key];
    }
    set({ messagesByKey: map, pendingOps: pending, snoozesByKey });
    for (const key of messageKeys) send({ type: "unsnooze", messageKey: key });
  },
  trashThread: (messageKeys) => {
    if (messageKeys.length === 0) return;
    flushDelta(set, get);
    const prev = get().messagesByKey;
    const map = { ...prev };
    const pending = { ...get().pendingOps };
    for (const key of messageKeys) {
      const m = prev[key];
      if (m) pending[key] = { kind: "trash", message: m };
      delete map[key];
    }
    const toastId = nextToastId();
    const toast: ToastRecord = {
      id: toastId,
      message: trashToastMessage(messageKeys.length),
      undo: { messageKeys, kind: "trash" },
    };
    const allToasts = [...get().toasts, toast];
    const newToasts = allToasts.slice(-TOAST_LIMIT);
    for (const dropped of allToasts.slice(0, allToasts.length - TOAST_LIMIT)) {
      if (dropped.undo) commitUndoToast(get, set, dropped.id);
    }
    set({ messagesByKey: map, pendingOps: pending, toasts: newToasts });
    const timer = setTimeout(() => commitUndoToast(get, set, toastId), UNDO_TIMEOUT_MS);
    undoTimers.set(toastId, timer);
  },
  moveToInboxThread: (messageKeys) => {
    if (messageKeys.length === 0) return;
    flushDelta(set, get);
    const prev = get().messagesByKey;
    const map = { ...prev };
    const pending = { ...get().pendingOps };
    for (const key of messageKeys) {
      const m = prev[key];
      if (!m) continue;
      pending[key] = { kind: "moveToInbox", message: m };
      map[key] = { ...m, origin: "inbox" };
    }
    set({ messagesByKey: map, pendingOps: pending });
    for (const key of messageKeys) send({ type: "move-to-inbox", messageKey: key });
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
  applyCategoryLocally: (messageKeys, category) => {
    flushDelta(set, get);
    const map = { ...get().messagesByKey };
    for (const key of messageKeys) {
      const m = map[key];
      if (m) map[key] = { ...m, category };
    }
    set({ messagesByKey: map });
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
  hydrateThreadDetails: (messageKeys) => {
    // Sent and draft rows are cached from headers alone so nothing downloads
    // them in the background; opening the conversation is what asks for them.
    // The background skips rows it has already hydrated, so this is cheap to
    // fire on every open.
    const pending = messageKeys.filter((key) => {
      const m = get().messagesByKey[key];
      return m && (m.detailsVersion ?? 0) < MESSAGE_DETAILS_VERSION;
    });
    if (pending.length) send({ type: "hydrate-details", messageKeys: pending });
  },
  markThreadRead: (messageKeys) => {
    const unread = messageKeys.filter((key) => {
      const m = get().messagesByKey[key];
      return m && !m.read;
    });
    if (unread.length === 0) return;
    flushDelta(set, get);
    const map = { ...get().messagesByKey };
    for (const key of unread) {
      const m = map[key];
      if (m) map[key] = { ...m, read: true };
    }
    set({ messagesByKey: map });
    send({ type: "mark-read", messageKeys: unread });
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
  importArchive: (since) => {
    if (get().archiveImport?.running) return;
    // Optimistic, so the button can't be pressed twice before progress lands.
    set({
      archiveImport: {
        ...get().archiveImport,
        running: true,
        since,
        scanned: 0,
        imported: 0,
        folders: 0,
        totalFolders: 0,
      },
    });
    send({ type: "archive-import", since });
  },
  stopArchiveImport: () => send({ type: "archive-import-cancel" }),
  reclassify: (messageKeys) => {
    if (get().reclassifying) return;
    set({ reclassifying: true });
    send({ type: "reclassify", messageKeys });
  },
});

import { useMemo } from "react";
import { create } from "zustand";
import { db } from "./db";
import { deriveStream, type Stream, type StreamView } from "./stream";
import type { ComposeDraft } from "../shared/compose";
import { MESSAGE_DETAILS_VERSION } from "../shared/details";
import { log } from "../shared/log";
import {
  PORT_NAME,
  type ClientMsg,
  type FailedCommand,
  type ServerMsg,
} from "../shared/messaging";
import type {
  Category,
  CustomBundleRecord,
  RawMessage,
  ReminderRecord,
  RouteRuleRecord,
  SnoozeRecord,
  Thread,
  TripMembershipRecord,
  TripRecord,
} from "../shared/types";

export type { Stream, StreamItem, StreamSection, StreamView } from "./stream";

interface BackgroundPort {
  postMessage: (msg: ClientMsg) => void;
  onMessage: { addListener: (cb: (msg: unknown) => void) => void };
  onDisconnect: { addListener: (cb: () => void) => void };
}

type RuntimeWithConnect = {
  connect: (info: { name: string }) => BackgroundPort;
};

interface SyncProgress {
  scanned: number;
  classified: number;
  done: boolean;
  error: string | null;
}

export type ConnectionState = "connected" | "reconnecting";

type PendingOp =
  | { kind: "done"; message: RawMessage }
  | { kind: "snooze"; message: RawMessage; wakeAt: number }
  | { kind: "unsnooze"; message: RawMessage; snooze?: SnoozeRecord }
  | { kind: "trash"; message: RawMessage }
  | { kind: "moveToInbox"; message: RawMessage };

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastRecord {
  id: string;
  message: string;
  retry?: { kind: FailedCommand; messageId: number; wakeAt?: number };
  undo?: { messageIds: number[]; kind: "done" | "trash" };
  actions?: ToastAction[];
}

/**
 * A request to open the bundle settings modal. Lives in the store (not
 * component state) so toast actions can open it after the originating thread
 * row has unmounted; `thread` is a snapshot for seeding rules from it.
 */
export interface BundleSettingsRequest {
  category?: Category | null;
  thread?: Thread;
  highlightRuleId?: string;
  startNewBundle?: boolean;
}

interface MailStore {
  messagesById: Record<number, RawMessage>;
  myEmails: ReadonlySet<string>;
  hydrated: boolean;
  syncProgress: SyncProgress | null;
  /**
   * How far the last full scan reached into the inbox. Null until a full scan
   * reports; `skipped: 0` means the whole inbox is in the window.
   */
  inboxWindow: { cap: number; skipped: number } | null;
  loadingMoreInbox: boolean;
  customBundles: CustomBundleRecord[];
  routeRules: RouteRuleRecord[];
  connectionState: ConnectionState;
  pendingOps: Record<number, PendingOp>;
  snoozesByMessageId: Record<number, SnoozeRecord>;
  remindersById: Record<string, ReminderRecord>;
  tripsById: Record<string, TripRecord>;
  tripMembershipByKey: Record<string, TripMembershipRecord>;
  toasts: ToastRecord[];
  bundleSettings: BundleSettingsRequest | null;
  reclassifying: boolean;

  init: () => Promise<void>;
  pin: (messageId: number, pinned: boolean) => void;
  doneThread: (messageIds: number[]) => void;
  snoozeThread: (messageIds: number[], wakeAt: number) => void;
  unsnoozeThread: (messageIds: number[]) => void;
  trashThread: (messageIds: number[]) => void;
  /** Restore done (archived) messages to their account's inbox. */
  moveToInboxThread: (messageIds: number[]) => void;
  setRouteRule: (rule: RouteRuleRecord) => void;
  deleteRouteRule: (id: string) => void;
  applyCategoryLocally: (messageIds: number[], category: Category | null) => void;
  setCustomBundle: (bundle: CustomBundleRecord) => void;
  deleteCustomBundle: (id: string) => void;
  createReminder: (text: string) => void;
  updateReminderText: (id: string, text: string) => void;
  setReminderPinned: (id: string, pinned: boolean) => void;
  snoozeReminder: (id: string, wakeAt: number) => void;
  unsnoozeReminder: (id: string) => void;
  doneReminder: (id: string) => void;
  restoreReminder: (id: string) => void;
  deleteReminder: (id: string) => void;
  /** Resurface snoozed reminders whose wake time has passed. */
  wakeDueReminders: () => void;
  /**
   * A cached row's TB id turned out stale (see resolveLiveMessageId): re-key
   * the row to the verified live id, or drop it when the live id is already
   * cached as its own row. Returns false when the row is left as is (snoozed
   * rows keep their id), in which case the caller should use the live id.
   */
  healStaleMessage: (staleId: number, liveId: number) => boolean;
  createTrip: (name: string) => TripRecord;
  renameTrip: (id: string, name: string) => void;
  deleteTrip: (id: string) => void;
  /**
   * Assign messages (by pinKey) to a trip; null removes them from all trips
   * and, as a tombstone, keeps auto-clustering (phase 2) from re-adding them.
   */
  setTripMembership: (keys: string[], tripId: string | null) => void;
  retryBackfill: () => void;
  /** Fetch details for a conversation's headers-only rows as it opens. */
  hydrateThreadDetails: (messageIds: number[]) => void;
  /** Widen the inbox scan window by one step and rescan. */
  loadMoreInbox: () => void;
  retryToast: (toastId: string) => void;
  undoToast: (toastId: string) => void;
  dismissToast: (toastId: string) => void;
  notify: (message: string, actions?: ToastAction[]) => void;
  openBundleSettings: (request: BundleSettingsRequest) => void;
  closeBundleSettings: () => void;
  /** Re-run bundling rules in the background; whole inbox when no ids given. */
  reclassify: (messageIds?: number[]) => void;
  /**
   * Hand an inline draft to Thunderbird: send it, or open it in a compose
   * window for the user to finish when `send` is false.
   */
  composeMessage: (draft: ComposeDraft, send: boolean) => void;
}

const UNDO_TIMEOUT_MS = 5000;

let toastSeq = 0;
const nextToastId = (): string => `t${++toastSeq}-${Date.now()}`;

let composeSeq = 0;
/** In-flight compose commands → the "Sending…" toast to replace when they end. */
const pendingCompose = new Map<string, string | null>();

const messagesLabel = (count: number): string =>
  count === 1 ? "Message" : `${count} messages`;

const doneToastMessage = (count: number): string =>
  `${messagesLabel(count)} marked as done`;

const trashToastMessage = (count: number): string =>
  count === 1 ? "Moved to trash" : `${count} messages moved to trash`;

const undoTimers = new Map<string, ReturnType<typeof setTimeout>>();

const commitUndoToast = (
  get: () => MailStore,
  set: (partial: Partial<MailStore>) => void,
  toastId: string,
): void => {
  const timer = undoTimers.get(toastId);
  if (timer !== undefined) {
    clearTimeout(timer);
    undoTimers.delete(toastId);
  }
  const toast = get().toasts.find((t) => t.id === toastId);
  if (toast?.undo) {
    for (const id of toast.undo.messageIds) {
      send({ type: toast.undo.kind, messageId: id });
    }
  }
  set({ toasts: get().toasts.filter((t) => t.id !== toastId) });
};

/** Reminders are SPA-owned; they persist straight to Dexie, no port round-trip. */
const persistReminder = (record: ReminderRecord): void => {
  void db.reminders.put(record).catch((e) => log.warn("store", "reminder save failed", e));
};

/** Trips are SPA-owned too (same model as reminders). */
const persistTrip = (record: TripRecord): void => {
  void db.trips.put(record).catch((e) => log.warn("store", "trip save failed", e));
};

const persistTripMemberships = (records: TripMembershipRecord[]): void => {
  void db.tripMemberships
    .bulkPut(records)
    .catch((e) => log.warn("store", "trip membership save failed", e));
};

let reminderWakeTimer: ReturnType<typeof setInterval> | null = null;

let port: BackgroundPort | null = null;

/**
 * Commands issued while the port is down. Dropping them would silently lose
 * mutations (a saved rule, a done/trash) that the optimistic UI already
 * applied; instead they flush in order once the port reconnects.
 */
const outbox: ClientMsg[] = [];

const send = (msg: ClientMsg): void => {
  if (!port) {
    outbox.push(msg);
    return;
  }
  try {
    port.postMessage(msg);
  } catch (e) {
    log.warn("store", "port send failed; queued for reconnect", e);
    outbox.push(msg);
  }
}

export const useMailStore = create<MailStore>((set, get) => ({
  messagesById: {},
  myEmails: new Set(),
  hydrated: false,
  syncProgress: null,
  inboxWindow: null,
  loadingMoreInbox: false,
  customBundles: [],
  routeRules: [],
  connectionState: "connected",
  pendingOps: {},
  snoozesByMessageId: {},
  remindersById: {},
  tripsById: {},
  tripMembershipByKey: {},
  toasts: [],
  bundleSettings: null,
  reclassifying: false,

  init: async () => {
    if (get().hydrated) return;
    const [all, rawBundles, routeRules, snoozes, reminders, trips, tripMemberships] =
      await Promise.all([
        db.messages.toArray(),
        db.customBundles.toArray(),
        db.routeRules.toArray(),
        db.snoozes.toArray(),
        db.reminders.toArray(),
        db.trips.toArray(),
        db.tripMemberships.toArray(),
      ]);
    const customBundles = rawBundles.sort((a, b) => a.order - b.order);
    const byId: Record<number, RawMessage> = {};
    for (const m of all) byId[m.id] = m;
    const snoozesByMessageId: Record<number, SnoozeRecord> = {};
    for (const snooze of snoozes) snoozesByMessageId[snooze.messageId] = snooze;
    const remindersById: Record<string, ReminderRecord> = {};
    for (const reminder of reminders) remindersById[reminder.id] = reminder;
    const tripsById: Record<string, TripRecord> = {};
    for (const trip of trips) tripsById[trip.id] = trip;
    const tripMembershipByKey: Record<string, TripMembershipRecord> = {};
    for (const membership of tripMemberships) tripMembershipByKey[membership.key] = membership;
    set({
      messagesById: byId,
      hydrated: true,
      customBundles,
      routeRules,
      snoozesByMessageId,
      remindersById,
      tripsById,
      tripMembershipByKey,
    });

    get().wakeDueReminders();
    if (reminderWakeTimer === null) {
      reminderWakeTimer = setInterval(() => get().wakeDueReminders(), 30_000);
    }

    const runtime = messenger.runtime as unknown as RuntimeWithConnect;
    if (!runtime.connect) {
      log.warn("store", "runtime.connect unavailable");
      return;
    }

    let backoff = 500;
    const connect = (): void => {
      const next = runtime.connect({ name: PORT_NAME });
      port = next;
      next.onMessage.addListener((raw) => {
        if (!raw || typeof raw !== "object") return;
        applyServerMsg(set, get, raw as ServerMsg);
      });
      next.onDisconnect.addListener(() => {
        if (port === next) port = null;
        // A reclassify in flight died with the port; unstick the button.
        set({ connectionState: "reconnecting", reclassifying: false });
        setTimeout(() => {
          backoff = Math.min(backoff * 2, 10_000);
          connect();
        }, backoff);
      });
      set({ connectionState: "connected" });
      backoff = 500;
      send({ type: "hello" });
      // Flush anything queued while disconnected; a failed post requeues.
      for (const queued of outbox.splice(0, outbox.length)) send(queued);
    };
    connect();
  },

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

  createReminder: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const record: ReminderRecord = {
      id: crypto.randomUUID(),
      text: trimmed,
      createdAt: Date.now(),
      status: "active",
      pinned: false,
    };
    set({ remindersById: { ...get().remindersById, [record.id]: record } });
    persistReminder(record);
  },

  updateReminderText: (id, text) => {
    const prev = get().remindersById[id];
    const trimmed = text.trim();
    if (!prev || !trimmed || prev.text === trimmed) return;
    const next = { ...prev, text: trimmed };
    set({ remindersById: { ...get().remindersById, [id]: next } });
    persistReminder(next);
  },

  setReminderPinned: (id, pinned) => {
    const prev = get().remindersById[id];
    if (!prev) return;
    const next = { ...prev, pinned };
    set({ remindersById: { ...get().remindersById, [id]: next } });
    persistReminder(next);
  },

  snoozeReminder: (id, wakeAt) => {
    const prev = get().remindersById[id];
    if (!prev) return;
    const next: ReminderRecord = { ...prev, snoozeWakeAt: wakeAt };
    delete next.resurfacedAt;
    delete next.snoozeExpired;
    set({ remindersById: { ...get().remindersById, [id]: next } });
    persistReminder(next);
  },

  unsnoozeReminder: (id) => {
    const prev = get().remindersById[id];
    if (!prev) return;
    const next: ReminderRecord = { ...prev, resurfacedAt: Date.now() };
    delete next.snoozeWakeAt;
    delete next.snoozeExpired;
    set({ remindersById: { ...get().remindersById, [id]: next } });
    persistReminder(next);
  },

  doneReminder: (id) => {
    const prev = get().remindersById[id];
    if (!prev) return;
    const next: ReminderRecord = { ...prev, status: "done", doneAt: Date.now() };
    delete next.snoozeWakeAt;
    set({ remindersById: { ...get().remindersById, [id]: next } });
    persistReminder(next);
    get().notify("Reminder marked as done", [
      {
        label: "Undo",
        run: () => {
          set({ remindersById: { ...get().remindersById, [id]: prev } });
          persistReminder(prev);
        },
      },
    ]);
  },

  restoreReminder: (id) => {
    const prev = get().remindersById[id];
    if (!prev) return;
    const next: ReminderRecord = { ...prev, status: "active", resurfacedAt: Date.now() };
    delete next.snoozeExpired;
    delete next.doneAt;
    set({ remindersById: { ...get().remindersById, [id]: next } });
    persistReminder(next);
    get().notify("Reminder moved back to inbox");
  },

  deleteReminder: (id) => {
    const prev = get().remindersById[id];
    if (!prev) return;
    const map = { ...get().remindersById };
    delete map[id];
    set({ remindersById: map });
    void db.reminders.delete(id).catch((e) => log.warn("store", "reminder delete failed", e));
    get().notify("Reminder deleted", [
      {
        label: "Undo",
        run: () => {
          set({ remindersById: { ...get().remindersById, [id]: prev } });
          persistReminder(prev);
        },
      },
    ]);
  },

  wakeDueReminders: () => {
    const now = Date.now();
    const map = get().remindersById;
    const due = Object.values(map).filter(
      (r) => r.snoozeWakeAt !== undefined && r.snoozeWakeAt <= now,
    );
    if (!due.length) return;
    const next = { ...map };
    for (const r of due) {
      const woken: ReminderRecord = { ...r, resurfacedAt: r.snoozeWakeAt, snoozeExpired: true };
      delete woken.snoozeWakeAt;
      next[r.id] = woken;
      persistReminder(woken);
    }
    set({ remindersById: next });
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
    void db.messages.delete(staleId).catch((e) => log.warn("store", "stale row delete failed", e));
    if (!map[liveId]) {
      const healed = { ...stale, id: liveId };
      map[liveId] = healed;
      void db.messages.put(healed).catch((e) => log.warn("store", "healed row save failed", e));
    }
    log.info("store", "healed stale message id", { staleId, liveId });
    set({ messagesById: map });
    return true;
  },

  createTrip: (name) => {
    const record: TripRecord = {
      id: crypto.randomUUID(),
      name: name.trim() || "New trip",
      nameIsCustom: !!name.trim(),
      createdAt: Date.now(),
    };
    set({ tripsById: { ...get().tripsById, [record.id]: record } });
    persistTrip(record);
    return record;
  },

  renameTrip: (id, name) => {
    const prev = get().tripsById[id];
    const trimmed = name.trim();
    if (!prev || !trimmed || prev.name === trimmed) return;
    const next: TripRecord = { ...prev, name: trimmed, nameIsCustom: true };
    set({ tripsById: { ...get().tripsById, [id]: next } });
    persistTrip(next);
  },

  deleteTrip: (id) => {
    const prev = get().tripsById[id];
    if (!prev) return;
    const trips = { ...get().tripsById };
    delete trips[id];
    const memberships = { ...get().tripMembershipByKey };
    const removed: TripMembershipRecord[] = [];
    for (const [key, record] of Object.entries(memberships)) {
      if (record.tripId === id) {
        removed.push(record);
        delete memberships[key];
      }
    }
    set({ tripsById: trips, tripMembershipByKey: memberships });
    void db.trips.delete(id).catch((e) => log.warn("store", "trip delete failed", e));
    void db.tripMemberships
      .bulkDelete(removed.map((r) => r.key))
      .catch((e) => log.warn("store", "trip membership delete failed", e));
    get().notify("Trip deleted", [
      {
        label: "Undo",
        run: () => {
          set({
            tripsById: { ...get().tripsById, [id]: prev },
            tripMembershipByKey: {
              ...get().tripMembershipByKey,
              ...Object.fromEntries(removed.map((r) => [r.key, r])),
            },
          });
          persistTrip(prev);
          persistTripMemberships(removed);
        },
      },
    ]);
  },

  setTripMembership: (keys, tripId) => {
    if (keys.length === 0) return;
    const now = Date.now();
    const destination = tripId ? get().tripsById[tripId] : undefined;
    const previous = keys
      .map((key) => get().tripMembershipByKey[key])
      .filter((r): r is TripMembershipRecord => !!r);
    // Trips these keys are leaving, and so might be the last mail in.
    const vacated = new Set(
      previous
        .map((r) => r.tripId)
        .filter((id): id is string => !!id && id !== tripId),
    );

    const records = keys.map(
      (key): TripMembershipRecord => ({
        key,
        tripId,
        source: "manual",
        addedAt: now,
        // Tombstones (tripId null) carry no reason — there's no membership to
        // explain, and a stale one would surface on a later re-add.
        reason: tripId ? { kind: "manual" } : undefined,
      }),
    );
    const memberships = { ...get().tripMembershipByKey };
    for (const r of records) memberships[r.key] = r;

    // Google Inbox deleted a trip the moment its last message left, rather
    // than leaving an empty shell to be tidied up by hand.
    //
    // "Empty" means no membership row points at it — never "no visible
    // threads". The stream hides snoozed mail and, outside the trip view,
    // archived mail, so a trip whose flights are all snoozed until next month
    // has zero visible threads and is very much alive. Deciding this from the
    // stream would delete it.
    const trips = { ...get().tripsById };
    const emptied: TripRecord[] = [];
    for (const id of vacated) {
      const trip = trips[id];
      if (!trip) continue;
      if (Object.values(memberships).some((r) => r.tripId === id)) continue;
      emptied.push(trip);
      delete trips[id];
    }

    set({ tripMembershipByKey: memberships, tripsById: trips });
    persistTripMemberships(records);
    for (const trip of emptied) {
      void db.trips
        .delete(trip.id)
        .catch((e) => log.warn("store", "empty trip delete failed", e));
    }

    const emptiedNames = emptied.map((t) => t.name).join(", ");
    const message = destination
      ? emptied.length
        ? `Moved to ${destination.name} · ${emptiedNames} was empty and was deleted`
        : `Moved to ${destination.name}`
      : emptied.length
        ? `Removed from trip · ${emptiedNames} was empty and was deleted`
        : "Removed from trip";

    get().notify(message, [
      {
        label: "Undo",
        run: () => {
          const restoredMemberships = { ...get().tripMembershipByKey };
          for (const key of keys) delete restoredMemberships[key];
          for (const r of previous) restoredMemberships[r.key] = r;
          const restoredTrips = { ...get().tripsById };
          for (const trip of emptied) restoredTrips[trip.id] = trip;
          set({
            tripMembershipByKey: restoredMemberships,
            tripsById: restoredTrips,
          });
          for (const trip of emptied) persistTrip(trip);
          if (previous.length) persistTripMemberships(previous);
          const orphaned = keys.filter((key) => !previous.some((r) => r.key === key));
          if (orphaned.length) {
            void db.tripMemberships
              .bulkDelete(orphaned)
              .catch((e) => log.warn("store", "trip membership undo failed", e));
          }
        },
      },
    ]);
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

  retryToast: (toastId) => {
    const toast = get().toasts.find((t) => t.id === toastId);
    if (!toast?.retry) return;
    set({ toasts: get().toasts.filter((t) => t.id !== toastId) });
    const { kind, messageId, wakeAt } = toast.retry;
    if (kind === "done") get().doneThread([messageId]);
    else if (kind === "trash") get().trashThread([messageId]);
    else if (kind === "unsnooze") get().unsnoozeThread([messageId]);
    else if (kind === "move-to-inbox") get().moveToInboxThread([messageId]);
    else if (kind === "snooze" && wakeAt !== undefined) {
      get().snoozeThread([messageId], wakeAt);
    }
  },

  undoToast: (toastId) => {
    flushDelta(set, get);
    const timer = undoTimers.get(toastId);
    if (timer !== undefined) {
      clearTimeout(timer);
      undoTimers.delete(toastId);
    }
    const toast = get().toasts.find((t) => t.id === toastId);
    if (toast?.undo) {
      const pending = { ...get().pendingOps };
      const map = { ...get().messagesById };
      for (const id of toast.undo.messageIds) {
        const op = pending[id];
        if (op) {
          map[id] = op.message;
          delete pending[id];
        }
      }
      set({ messagesById: map, pendingOps: pending });
    }
    set({ toasts: get().toasts.filter((t) => t.id !== toastId) });
  },

  dismissToast: (toastId) => {
    const toast = get().toasts.find((t) => t.id === toastId);
    if (toast?.undo) {
      commitUndoToast(get, set, toastId);
    } else {
      set({ toasts: get().toasts.filter((t) => t.id !== toastId) });
    }
  },

  notify: (message, actions) => {
    const toast: ToastRecord = { id: nextToastId(), message, actions };
    set({ toasts: [...get().toasts, toast].slice(-TOAST_LIMIT) });
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

  composeMessage: (draft, sendNow) => {
    const requestId = `c${++composeSeq}-${Date.now()}`;
    let toastId: string | null = null;
    if (sendNow) {
      const toast: ToastRecord = { id: nextToastId(), message: "Sending…" };
      toastId = toast.id;
      set({ toasts: [...get().toasts, toast].slice(-TOAST_LIMIT) });
    }
    pendingCompose.set(requestId, toastId);
    send({ type: "compose", requestId, draft, send: sendNow });
  },
}));

const TOAST_LIMIT = 3;

const failureLabel = (command: FailedCommand): string => {
  if (command === "done") return "Couldn't archive";
  if (command === "snooze") return "Couldn't snooze";
  if (command === "unsnooze") return "Couldn't unsnooze";
  if (command === "move-to-inbox") return "Couldn't move to inbox";
  return "Couldn't move to trash";
}

/**
 * Deltas are buffered and applied as one store write instead of one write
 * each.
 *
 * A scan broadcasts a delta every hundred rows, and each write replaces
 * messagesById — which invalidates the stream memo and costs a full re-thread
 * (buildThreads unions every visible message) plus a re-render. A large
 * mailbox paid for that a hundred times over while it synced. The flush lands
 * on a timer, so deltas arriving faster than the event loop drains collapse
 * into a single update, while an isolated delta still applies on the next tick.
 */
const REMOVED = Symbol("removed");
type BufferedRow = RawMessage | typeof REMOVED;

let pendingRows: Map<number, BufferedRow> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Applies the buffered deltas now.
 *
 * Every optimistic mutation calls this first. Without it, a delta queued in
 * one turn and a click in the next would race: the flush would overwrite the
 * row the click just changed with a copy that predates it, and the action
 * would visibly revert until the next delta corrected it.
 */
const flushDelta = (
  set: (partial: Partial<MailStore>) => void,
  get: () => MailStore,
): void => {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const rows = pendingRows;
  pendingRows = null;
  if (!rows?.size) return;

  const map = { ...get().messagesById };
  const snoozesByMessageId = { ...get().snoozesByMessageId };
  const pending = { ...get().pendingOps };
  let pendingChanged = false;

  for (const [id, row] of rows) {
    if (row === REMOVED) {
      delete map[id];
      delete snoozesByMessageId[id];
    } else {
      map[id] = row;
      // A message that comes back unsnoozed has woken; drop any stale record.
      if (snoozesByMessageId[id] && !row.snoozed) delete snoozesByMessageId[id];
    }
    // Any delta naming a message settles the optimistic op waiting on it.
    if (id in pending) {
      delete pending[id];
      pendingChanged = true;
    }
  }

  set({
    messagesById: map,
    snoozesByMessageId,
    ...(pendingChanged ? { pendingOps: pending } : {}),
  });
};

const applyServerMsg = (
  set: (partial: Partial<MailStore>) => void,
  get: () => MailStore,
  msg: ServerMsg,
): void => {
  switch (msg.type) {
    case "delta": {
      // Last write per id wins, which is what applying the deltas in arrival
      // order would produce: a row added then removed ends up removed, and a
      // row removed then re-added ends up present.
      const rows = (pendingRows ??= new Map());
      if (msg.added) for (const m of msg.added) rows.set(m.id, m);
      if (msg.updated) for (const m of msg.updated) rows.set(m.id, m);
      if (msg.removedIds) for (const id of msg.removedIds) rows.set(id, REMOVED);
      if (flushTimer === null) {
        flushTimer = setTimeout(() => flushDelta(set, get), 0);
      }
      return;
    }
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
      });
      return;
    case "inbox-window":
      set({
        inboxWindow: { cap: msg.cap, skipped: msg.skipped },
        loadingMoreInbox: false,
      });
      return;
    case "command-failed": {
      // The rollback restores the pre-op row, so it must land after any delta
      // still buffered for that message rather than be overwritten by it.
      flushDelta(set, get);
      const pending = { ...get().pendingOps };
      const op = pending[msg.messageId];
      const map = { ...get().messagesById };
      if (op) {
        map[msg.messageId] = op.message;
        delete pending[msg.messageId];
      }
      const wakeAt = op?.kind === "snooze" ? op.wakeAt : undefined;
      const snoozesByMessageId = { ...get().snoozesByMessageId };
      if (msg.command === "snooze") delete snoozesByMessageId[msg.messageId];
      if (msg.command === "unsnooze" && op?.kind === "unsnooze" && op.snooze) {
        snoozesByMessageId[msg.messageId] = op.snooze;
      }
      const toast: ToastRecord = {
        id: nextToastId(),
        message: `${failureLabel(msg.command)} — ${msg.reason}`,
        retry: { kind: msg.command, messageId: msg.messageId, wakeAt },
      };
      const toasts = [...get().toasts, toast].slice(-TOAST_LIMIT);
      set({ messagesById: map, pendingOps: pending, snoozesByMessageId, toasts });
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
      set({ toasts: toasts.slice(-TOAST_LIMIT) });
      return;
    }
    case "trips-delta": {
      // Background auto-clusterer output; already persisted to Dexie. Merge
      // into the store, but a manual membership made here always beats an
      // incoming auto row for the same key — the clusterer read our state
      // before this user action landed.
      const tripsById = { ...get().tripsById };
      for (const id of msg.removedTripIds) delete tripsById[id];
      for (const trip of msg.trips) tripsById[trip.id] = trip;
      const membershipByKey = { ...get().tripMembershipByKey };
      for (const key of msg.removedMembershipKeys) {
        if (membershipByKey[key]?.source === "manual") continue;
        delete membershipByKey[key];
      }
      for (const m of msg.memberships) {
        if (membershipByKey[m.key]?.source === "manual") continue;
        membershipByKey[m.key] = m;
      }
      set({ tripsById, tripMembershipByKey: membershipByKey });
      return;
    }
    case "error":
      log.warn("store", "server error", msg.message);
      return;
  }
}

// ─── selectors ──────────────────────────────────────────────────────────────

export const useStream = (): Stream => {
  const messagesById = useMailStore((s) => s.messagesById);
  const myEmails = useMailStore((s) => s.myEmails);
  return useMemo(
    () => deriveStream(messagesById, myEmails),
    [messagesById, myEmails],
  );
}

export const useStreamForView = (view: StreamView, pinnedOnly = false): Stream => {
  const messagesById = useMailStore((s) => s.messagesById);
  const myEmails = useMailStore((s) => s.myEmails);
  const snoozesByMessageId = useMailStore((s) => s.snoozesByMessageId);
  const remindersById = useMailStore((s) => s.remindersById);
  const tripsById = useMailStore((s) => s.tripsById);
  const tripMembershipByKey = useMailStore((s) => s.tripMembershipByKey);
  return useMemo(
    () =>
      deriveStream(
        messagesById,
        myEmails,
        view,
        snoozesByMessageId,
        pinnedOnly,
        remindersById,
        tripsById,
        tripMembershipByKey,
      ),
    [messagesById, myEmails, view, snoozesByMessageId, pinnedOnly, remindersById, tripsById, tripMembershipByKey],
  );
}

export const useHydrated = (): boolean => {
  return useMailStore((s) => s.hydrated);
}

export const useSyncProgress = (): SyncProgress | null => {
  return useMailStore((s) => s.syncProgress);
}

export const useConnectionState = (): ConnectionState => {
  return useMailStore((s) => s.connectionState);
}

export const useCustomBundles = (): CustomBundleRecord[] => {
  return useMailStore((s) => s.customBundles);
}

export const useRouteRules = (): RouteRuleRecord[] => {
  return useMailStore((s) => s.routeRules);
}

export const useToasts = (): ToastRecord[] => {
  return useMailStore((s) => s.toasts);
}

export const useBundleSettings = (): BundleSettingsRequest | null => {
  return useMailStore((s) => s.bundleSettings);
}

export const useTrips = (): Record<string, TripRecord> => {
  return useMailStore((s) => s.tripsById);
}

export const useTripMemberships = (): Record<string, TripMembershipRecord> => {
  return useMailStore((s) => s.tripMembershipByKey);
}

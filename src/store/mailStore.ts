import { useMemo } from "react";
import { create } from "zustand";
import { db } from "./db";
import { deriveStream, type Stream, type StreamView } from "./stream";
import { log } from "../shared/log";
import {
  PORT_NAME,
  type ClientMsg,
  type FailedCommand,
  type ServerMsg,
} from "../shared/messaging";
import type { Category, CustomBundleRecord, RawMessage, ReminderRecord, RouteRuleRecord, SnoozeRecord, Thread } from "../shared/types";

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
  customBundles: CustomBundleRecord[];
  routeRules: RouteRuleRecord[];
  connectionState: ConnectionState;
  pendingOps: Record<number, PendingOp>;
  snoozesByMessageId: Record<number, SnoozeRecord>;
  remindersById: Record<string, ReminderRecord>;
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
  retryBackfill: () => void;
  retryToast: (toastId: string) => void;
  undoToast: (toastId: string) => void;
  dismissToast: (toastId: string) => void;
  notify: (message: string, actions?: ToastAction[]) => void;
  openBundleSettings: (request: BundleSettingsRequest) => void;
  closeBundleSettings: () => void;
  /** Re-run bundling rules in the background; whole inbox when no ids given. */
  reclassify: (messageIds?: number[]) => void;
}

const UNDO_TIMEOUT_MS = 5000;

let toastSeq = 0;
const nextToastId = (): string => `t${++toastSeq}-${Date.now()}`;

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
  customBundles: [],
  routeRules: [],
  connectionState: "connected",
  pendingOps: {},
  snoozesByMessageId: {},
  remindersById: {},
  toasts: [],
  bundleSettings: null,
  reclassifying: false,

  init: async () => {
    if (get().hydrated) return;
    const [all, rawBundles, routeRules, snoozes, reminders] = await Promise.all([
      db.messages.toArray(),
      db.customBundles.toArray(),
      db.routeRules.toArray(),
      db.snoozes.toArray(),
      db.reminders.toArray(),
    ]);
    const customBundles = rawBundles.sort((a, b) => a.order - b.order);
    const byId: Record<number, RawMessage> = {};
    for (const m of all) byId[m.id] = m;
    const snoozesByMessageId: Record<number, SnoozeRecord> = {};
    for (const snooze of snoozes) snoozesByMessageId[snooze.messageId] = snooze;
    const remindersById: Record<string, ReminderRecord> = {};
    for (const reminder of reminders) remindersById[reminder.id] = reminder;
    set({ messagesById: byId, hydrated: true, customBundles, routeRules, snoozesByMessageId, remindersById });

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
    const prev = get().messagesById;
    const map = { ...prev };
    const pending = { ...get().pendingOps };
    for (const id of messageIds) {
      const m = prev[id];
      if (m) pending[id] = { kind: "done", message: m };
      delete map[id];
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
    const prev = get().messagesById;
    const map = { ...prev };
    const pending = { ...get().pendingOps };
    const snoozesByMessageId = { ...get().snoozesByMessageId };
    const now = Date.now();
    for (const id of messageIds) {
      const m = prev[id];
      if (!m) continue;
      pending[id] = { kind: "unsnooze", message: m, snooze: snoozesByMessageId[id] };
      map[id] = { ...m, snoozed: false, resurfacedAt: now };
      delete snoozesByMessageId[id];
    }
    set({ messagesById: map, pendingOps: pending, snoozesByMessageId });
    for (const id of messageIds) send({ type: "unsnooze", messageId: id });
  },

  trashThread: (messageIds) => {
    if (messageIds.length === 0) return;
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
    set({ remindersById: { ...get().remindersById, [id]: next } });
    persistReminder(next);
  },

  unsnoozeReminder: (id) => {
    const prev = get().remindersById[id];
    if (!prev) return;
    const next: ReminderRecord = { ...prev, resurfacedAt: Date.now() };
    delete next.snoozeWakeAt;
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
      const woken: ReminderRecord = { ...r, resurfacedAt: r.snoozeWakeAt };
      delete woken.snoozeWakeAt;
      next[r.id] = woken;
      persistReminder(woken);
    }
    set({ remindersById: next });
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
}));

const TOAST_LIMIT = 3;

const failureLabel = (command: FailedCommand): string => {
  if (command === "done") return "Couldn't archive";
  if (command === "snooze") return "Couldn't snooze";
  if (command === "unsnooze") return "Couldn't unsnooze";
  if (command === "move-to-inbox") return "Couldn't move to inbox";
  return "Couldn't move to trash";
}

const applyServerMsg = (
  set: (partial: Partial<MailStore>) => void,
  get: () => MailStore,
  msg: ServerMsg,
): void => {
  switch (msg.type) {
    case "delta": {
      const map = { ...get().messagesById };
      if (msg.added) for (const m of msg.added) map[m.id] = m;
      if (msg.updated) for (const m of msg.updated) map[m.id] = m;
      if (msg.removedIds) for (const id of msg.removedIds) delete map[id];
      const snoozesByMessageId = { ...get().snoozesByMessageId };
      if (msg.removedIds) for (const id of msg.removedIds) delete snoozesByMessageId[id];
      // A message that comes back unsnoozed has woken; drop any stale record.
      for (const m of [...(msg.added ?? []), ...(msg.updated ?? [])]) {
        if (snoozesByMessageId[m.id] && !m.snoozed) {
          delete snoozesByMessageId[m.id];
        }
      }
      set({ messagesById: map, snoozesByMessageId });
      const settledIds = [
        ...(msg.removedIds ?? []),
        ...(msg.added ?? []).map((m) => m.id),
        ...(msg.updated ?? []).map((m) => m.id),
      ];
      if (settledIds.length) {
        const pending = { ...get().pendingOps };
        let changed = false;
        for (const id of settledIds) {
          if (id in pending) {
            delete pending[id];
            changed = true;
          }
        }
        if (changed) set({ pendingOps: pending });
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
    case "command-failed": {
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
  return useMemo(
    () => deriveStream(messagesById, myEmails, view, snoozesByMessageId, pinnedOnly, remindersById),
    [messagesById, myEmails, view, snoozesByMessageId, pinnedOnly, remindersById],
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

import { useMemo } from "react";
import { create } from "zustand";
import { db } from "./db";
import { deriveStream, type Stream } from "./stream";
import { PINNED_KEY } from "../shared/categories";
import { log } from "../shared/log";
import {
  PORT_NAME,
  type ClientMsg,
  type ServerMsg,
} from "../shared/messaging";
import type { BuiltinCategory, BundleRuleRecord, CustomBundleRecord, OverrideRecord, RawMessage } from "../shared/types";

export type { Stream, StreamItem, StreamSection } from "./stream";

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
  | { kind: "trash"; message: RawMessage };

export interface ToastRecord {
  id: string;
  message: string;
  retry?: { kind: "done" | "snooze" | "trash"; messageId: number; wakeAt?: number };
  undo?: { messageIds: number[]; kind: "done" | "trash" };
}

interface MailStore {
  messagesById: Record<number, RawMessage>;
  myEmails: ReadonlySet<string>;
  hydrated: boolean;
  syncProgress: SyncProgress | null;
  customBundles: CustomBundleRecord[];
  bundleRules: BundleRuleRecord[];
  overrides: OverrideRecord[];
  connectionState: ConnectionState;
  pendingOps: Record<number, PendingOp>;
  toasts: ToastRecord[];

  init: () => Promise<void>;
  pin: (messageId: number, pinned: boolean) => void;
  doneThread: (messageIds: number[]) => void;
  snoozeThread: (messageIds: number[], wakeAt: number) => void;
  trashThread: (messageIds: number[]) => void;
  setOverride: (senderDomain: string, category: BuiltinCategory | null) => void;
  setBundleRule: (rule: BundleRuleRecord) => void;
  deleteBundleRule: (id: string) => void;
  setCustomBundle: (bundle: CustomBundleRecord) => void;
  deleteCustomBundle: (id: string) => void;
  retryBackfill: () => void;
  retryToast: (toastId: string) => void;
  undoToast: (toastId: string) => void;
  dismissToast: (toastId: string) => void;
  notify: (message: string) => void;
}

const UNDO_TIMEOUT_MS = 5000;

let toastSeq = 0;
const nextToastId = (): string => `t${++toastSeq}-${Date.now()}`;

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

let port: BackgroundPort | null = null;

const send = (msg: ClientMsg): void => {
  if (!port) return;
  try {
    port.postMessage(msg);
  } catch (e) {
    log.warn("store", "port send failed", e);
  }
}

export const useMailStore = create<MailStore>((set, get) => ({
  messagesById: {},
  myEmails: new Set(),
  hydrated: false,
  syncProgress: null,
  customBundles: [],
  bundleRules: [],
  overrides: [],
  connectionState: "connected",
  pendingOps: {},
  toasts: [],

  init: async () => {
    if (get().hydrated) return;
    const [all, rawBundles, bundleRules, overrides] = await Promise.all([
      db.messages.toArray(),
      db.customBundles.toArray(),
      db.bundleRules.toArray(),
      db.overrides.toArray(),
    ]);
    const customBundles = rawBundles.sort((a, b) => a.order - b.order);
    const byId: Record<number, RawMessage> = {};
    for (const m of all) byId[m.id] = m;
    set({ messagesById: byId, hydrated: true, customBundles, bundleRules, overrides });

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
        set({ connectionState: "reconnecting" });
        setTimeout(() => {
          backoff = Math.min(backoff * 2, 10_000);
          connect();
        }, backoff);
      });
      set({ connectionState: "connected" });
      backoff = 500;
      send({ type: "hello" });
    };
    connect();
  },

  pin: (messageId, pinned) => {
    const map = { ...get().messagesById };
    const m = map[messageId];
    if (m) {
      const tags = pinned
        ? [...m.tags.filter((t) => t !== PINNED_KEY), PINNED_KEY]
        : m.tags.filter((t) => t !== PINNED_KEY);
      map[messageId] = { ...m, tags, pinned };
      set({ messagesById: map });
    }
    send({ type: "pin", messageId, pinned });
  },

  doneThread: (messageIds) => {
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
      message: "Message marked as done",
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
    const prev = get().messagesById;
    const map = { ...prev };
    const pending = { ...get().pendingOps };
    for (const id of messageIds) {
      const m = prev[id];
      if (m) pending[id] = { kind: "snooze", message: m, wakeAt };
      delete map[id];
    }
    set({ messagesById: map, pendingOps: pending });
    for (const id of messageIds) send({ type: "snooze", messageId: id, wakeAt });
  },

  trashThread: (messageIds) => {
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
      message: "Moved to trash",
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

  setOverride: (senderDomain, category) => {
    const key = senderDomain.toLowerCase();
    const filtered = get().overrides.filter((o) => o.senderDomain !== key);
    const overrides = category ? [...filtered, { senderDomain: key, category }] : filtered;
    set({ overrides });
    send({ type: "override", senderDomain, category });
  },

  setBundleRule: (rule) => {
    const rules = get().bundleRules.filter((r) => r.id !== rule.id);
    rules.push(rule);
    set({ bundleRules: rules });
    send({ type: "set-bundle-rule", rule });
  },

  deleteBundleRule: (id) => {
    set({ bundleRules: get().bundleRules.filter((r) => r.id !== id) });
    send({ type: "delete-bundle-rule", id });
  },

  setCustomBundle: (bundle) => {
    const bundles = get().customBundles.filter((b) => b.id !== bundle.id);
    bundles.push(bundle);
    bundles.sort((a, b) => a.order - b.order);
    set({ customBundles: bundles });
    send({ type: "set-custom-bundle", bundle });
  },

  deleteCustomBundle: (id) => {
    set({ customBundles: get().customBundles.filter((b) => b.id !== id) });
    send({ type: "delete-custom-bundle", id });
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

  notify: (message) => {
    const toast: ToastRecord = { id: nextToastId(), message };
    set({ toasts: [...get().toasts, toast].slice(-TOAST_LIMIT) });
  },
}));

const TOAST_LIMIT = 3;

const failureLabel = (command: "done" | "snooze" | "trash"): string => {
  if (command === "done") return "Couldn't archive";
  if (command === "snooze") return "Couldn't snooze";
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
      set({ messagesById: map });
      if (msg.removedIds?.length) {
        const pending = { ...get().pendingOps };
        let changed = false;
        for (const id of msg.removedIds) {
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
      const toast: ToastRecord = {
        id: nextToastId(),
        message: `${failureLabel(msg.command)} — ${msg.reason}`,
        retry: { kind: msg.command, messageId: msg.messageId, wakeAt },
      };
      const toasts = [...get().toasts, toast].slice(-TOAST_LIMIT);
      set({ messagesById: map, pendingOps: pending, toasts });
      log.warn("store", "command failed", msg);
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

export const useOverrides = (): OverrideRecord[] => {
  return useMailStore((s) => s.overrides);
}

export const useBundleRules = (): BundleRuleRecord[] => {
  return useMailStore((s) => s.bundleRules);
}

export const useToasts = (): ToastRecord[] => {
  return useMailStore((s) => s.toasts);
}

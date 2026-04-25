import { useMemo } from "react";
import { create } from "zustand";
import { db } from "./db";
import {
  PINNED_KEY,
  SNOOZED_KEY,
} from "../shared/categories";
import {
  PORT_NAME,
  type ClientMsg,
  type ServerMsg,
} from "../shared/messaging";
import { buildThreads } from "../shared/threading";
import type { Category, RawMessage, Thread } from "../shared/types";
import { dateBucket } from "../spa/lib/dateBucket";

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
  tagged: number;
  done: boolean;
}

interface MailStore {
  messagesById: Record<number, RawMessage>;
  myEmails: ReadonlySet<string>;
  hydrated: boolean;
  syncProgress: SyncProgress | null;

  init: () => Promise<void>;
  pin: (messageId: number, pinned: boolean) => void;
  doneThread: (messageIds: number[]) => void;
  snoozeThread: (messageIds: number[], wakeAt: number) => void;
  trashThread: (messageIds: number[]) => void;
  reclassify: () => void;
  setOverride: (senderDomain: string, category: Category | null) => void;
}

let port: BackgroundPort | null = null;

function send(msg: ClientMsg): void {
  if (!port) return;
  try {
    port.postMessage(msg);
  } catch (e) {
    console.warn("[NeoInbox] port send failed", e);
  }
}

export const useMailStore = create<MailStore>((set, get) => ({
  messagesById: {},
  myEmails: new Set(),
  hydrated: false,
  syncProgress: null,

  init: async () => {
    if (get().hydrated) return;
    const all = await db.messages.toArray();
    const byId: Record<number, RawMessage> = {};
    for (const m of all) byId[m.id] = m;
    set({ messagesById: byId, hydrated: true });

    const runtime = messenger.runtime as unknown as RuntimeWithConnect;
    if (!runtime.connect) {
      console.warn("[NeoInbox] runtime.connect unavailable");
      return;
    }
    port = runtime.connect({ name: PORT_NAME });
    port.onMessage.addListener((raw) => {
      if (!raw || typeof raw !== "object") return;
      applyServerMsg(set, get, raw as ServerMsg);
    });
    port.onDisconnect.addListener(() => {
      port = null;
    });
    send({ type: "hello" });
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
    const map = { ...get().messagesById };
    for (const id of messageIds) delete map[id];
    set({ messagesById: map });
    for (const id of messageIds) send({ type: "done", messageId: id });
  },

  snoozeThread: (messageIds, wakeAt) => {
    const map = { ...get().messagesById };
    for (const id of messageIds) delete map[id];
    set({ messagesById: map });
    for (const id of messageIds) send({ type: "snooze", messageId: id, wakeAt });
  },

  trashThread: (messageIds) => {
    const map = { ...get().messagesById };
    for (const id of messageIds) delete map[id];
    set({ messagesById: map });
    for (const id of messageIds) send({ type: "trash", messageId: id });
  },

  reclassify: () => send({ type: "reclassify" }),

  setOverride: (senderDomain, category) =>
    send({ type: "override", senderDomain, category }),
}));

function applyServerMsg(
  set: (partial: Partial<MailStore>) => void,
  get: () => MailStore,
  msg: ServerMsg,
): void {
  switch (msg.type) {
    case "delta": {
      const map = { ...get().messagesById };
      if (msg.added) for (const m of msg.added) map[m.id] = m;
      if (msg.updated) for (const m of msg.updated) map[m.id] = m;
      if (msg.removedIds) for (const id of msg.removedIds) delete map[id];
      set({ messagesById: map });
      return;
    }
    case "myEmails":
      set({ myEmails: new Set(msg.emails) });
      return;
    case "backfill-progress":
      set({
        syncProgress: {
          scanned: msg.scanned,
          tagged: msg.tagged,
          done: msg.done,
        },
      });
      return;
    case "error":
      console.warn("[NeoInbox] server error", msg.message);
      return;
  }
}

// ─── selectors ──────────────────────────────────────────────────────────────

export type StreamItem =
  | { type: "thread"; date: number; thread: Thread }
  | {
      type: "bundle";
      date: number;
      category: Category;
      threads: Thread[];
    };

export interface StreamSection {
  label: string;
  items: StreamItem[];
}

export interface Stream {
  pinned: Thread[];
  sections: StreamSection[];
  threadCount: number;
}

const SECTION_ORDER = [
  "Today",
  "Yesterday",
  "This week",
  "Last week",
  "This month",
];

function compareSection(a: string, b: string): number {
  const ia = SECTION_ORDER.indexOf(a);
  const ib = SECTION_ORDER.indexOf(b);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return 0;
}

function deriveStream(
  messagesById: Record<number, RawMessage>,
  myEmails: ReadonlySet<string>,
): Stream {
  const visible = Object.values(messagesById).filter(
    (m) => !m.tags.includes(SNOOZED_KEY),
  );
  const threads = buildThreads(visible, myEmails);
  const pinned = threads.filter((t) => t.pinned);
  const unpinned = threads.filter((t) => !t.pinned);

  const byCategory = new Map<Category, Thread[]>();
  const personal: Thread[] = [];
  for (const t of unpinned) {
    if (t.category) {
      let arr = byCategory.get(t.category);
      if (!arr) {
        arr = [];
        byCategory.set(t.category, arr);
      }
      arr.push(t);
    } else {
      personal.push(t);
    }
  }

  const items: StreamItem[] = [
    ...[...byCategory.entries()].map(([category, ts]) => {
      const sorted = [...ts].sort((a, b) => b.latestDate - a.latestDate);
      return {
        type: "bundle" as const,
        date: sorted[0]?.latestDate ?? 0,
        category,
        threads: sorted,
      };
    }),
    ...personal.map((t) => ({
      type: "thread" as const,
      date: t.latestDate,
      thread: t,
    })),
  ].sort((a, b) => b.date - a.date);

  const byBucket = new Map<string, StreamItem[]>();
  for (const item of items) {
    const label = dateBucket(item.date);
    let arr = byBucket.get(label);
    if (!arr) {
      arr = [];
      byBucket.set(label, arr);
    }
    arr.push(item);
  }

  const sections: StreamSection[] = [];
  for (const [label, sectionItems] of byBucket) {
    sections.push({ label, items: sectionItems });
  }

  sections.sort((a, b) => {
    const order = compareSection(a.label, b.label);
    if (order !== 0) return order;
    const aDate = a.items[0]?.date ?? 0;
    const bDate = b.items[0]?.date ?? 0;
    return bDate - aDate;
  });

  return { pinned, sections, threadCount: threads.length };
}

export function useStream(): Stream {
  const messagesById = useMailStore((s) => s.messagesById);
  const myEmails = useMailStore((s) => s.myEmails);
  return useMemo(
    () => deriveStream(messagesById, myEmails),
    [messagesById, myEmails],
  );
}

export function useHydrated(): boolean {
  return useMailStore((s) => s.hydrated);
}

export function useSyncProgress(): SyncProgress | null {
  return useMailStore((s) => s.syncProgress);
}

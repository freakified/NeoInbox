import { SNOOZED_KEY } from "../shared/categories";
import { buildThreads } from "../shared/threading";
import type { Category, MessageOrigin, RawMessage, SnoozeRecord, Thread } from "../shared/types";
import { dateBucket, futureDateBucket } from "../spa/lib/dateBucket";

export type StreamView =
  | { type: "inbox" }
  | { type: "snoozed" }
  | { type: "draft" }
  | { type: "sent" }
  | { type: "done" }
  | { type: "bundle"; category: Category };

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
  view: StreamView;
}

const SECTION_ORDER = [
  "Today",
  "Tomorrow",
  "Yesterday",
  "This week",
  "Next week",
  "Last week",
  "This month",
];

const compareSection = (a: string, b: string): number => {
  const ia = SECTION_ORDER.indexOf(a);
  const ib = SECTION_ORDER.indexOf(b);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return 0;
}

export const deriveStream = (
  messagesById: Record<number, RawMessage>,
  myEmails: ReadonlySet<string>,
  view: StreamView = { type: "inbox" },
  snoozesByMessageId: Record<number, SnoozeRecord> = {},
): Stream => {
  const allMessages = Object.values(messagesById);
  const anchorOrigins: ReadonlySet<MessageOrigin> = new Set(
    view.type === "sent"
      ? ["sent"]
      : view.type === "draft"
        ? ["draft"]
        : view.type === "done"
          ? ["done"]
          : ["inbox"],
  );
  const visible = allMessages.filter((m) => {
    if (view.type === "inbox") {
      return m.origin === "sent" || m.origin === "draft" || (m.origin === "inbox" && !m.tags.includes(SNOOZED_KEY));
    }
    if (view.type === "snoozed") {
      return m.origin === "sent" || m.origin === "draft" || (m.origin === "inbox" && m.tags.includes(SNOOZED_KEY));
    }
    if (view.type === "draft") return m.origin === "draft";
    if (view.type === "sent") return m.origin === "sent";
    if (view.type === "done") return m.origin === "sent" || m.origin === "draft" || m.origin === "done";
    return (
      m.origin === "sent" ||
      m.origin === "draft" ||
      (m.origin === "inbox" && !m.tags.includes(SNOOZED_KEY) && m.category === view.category)
    );
  });
  let threads = buildThreads(visible, myEmails, anchorOrigins);
  if (view.type === "snoozed") {
    threads = threads
      .map((thread) => {
        const dueAt = thread.messages
          .map((m) => snoozesByMessageId[m.id]?.wakeAt)
          .filter((wakeAt): wakeAt is number => typeof wakeAt === "number")
          .sort((a, b) => a - b)[0];
        return dueAt ? { ...thread, latestDate: dueAt, snoozeDueAt: dueAt } : thread;
      })
      .filter((thread) => typeof thread.snoozeDueAt === "number");
  }
  const showInboxBundles = view.type === "inbox";
  const showPinned = view.type === "inbox";
  const pinned = showPinned ? threads.filter((t) => t.pinned) : [];
  const unpinned = showPinned ? threads.filter((t) => !t.pinned) : threads;

  const byCategory = new Map<Category, Thread[]>();
  const personal: Thread[] = [];
  for (const t of unpinned) {
    if (showInboxBundles && t.category) {
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
  ].sort((a, b) => view.type === "snoozed" ? a.date - b.date : b.date - a.date);

  const byBucket = new Map<string, StreamItem[]>();
  for (const item of items) {
    const label = view.type === "snoozed" ? futureDateBucket(item.date) : dateBucket(item.date);
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
    return view.type === "snoozed" ? aDate - bDate : bDate - aDate;
  });

  return { pinned, sections, threadCount: threads.length, view };
}

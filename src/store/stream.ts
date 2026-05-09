import { SNOOZED_KEY } from "../shared/categories";
import { buildThreads } from "../shared/threading";
import type { Category, RawMessage, Thread } from "../shared/types";
import { dateBucket } from "../spa/lib/dateBucket";

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
): Stream => {
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

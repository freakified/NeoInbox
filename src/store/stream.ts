import { buildThreads } from "../shared/threading";
import { pinKeyOf } from "../shared/pinKey";
import { tripIdOfThread, tripWhen } from "../shared/trips";
import type {
  Category,
  MessageOrigin,
  RawMessage,
  ReminderRecord,
  SnoozeRecord,
  Thread,
  TripMembershipRecord,
  TripRecord,
} from "../shared/types";
import { dateBucket, futureDateBucket } from "../spa/lib/dateBucket";

export type StreamView =
  | { type: "inbox" }
  | { type: "snoozed" }
  | { type: "draft" }
  | { type: "sent" }
  | { type: "done" }
  | { type: "reminders" }
  // Trips is not a bundle: membership is explicit (TripMembershipRecord), not
  // a category, so it gets its own view rather than borrowing a category name.
  | { type: "trips" }
  | { type: "bundle"; category: Category };

export type StreamItem =
  | { type: "thread"; date: number; thread: Thread }
  | { type: "reminder"; date: number; reminder: ReminderRecord }
  | {
    type: "bundle";
    date: number;
    category: Category;
    threads: Thread[];
  }
  | {
    type: "trip";
    date: number;
    trip: TripRecord;
    threads: Thread[];
  };

export interface StreamSection {
  label: string;
  items: StreamItem[];
}

export interface Stream {
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

/** Which reminders show in a view, and the date that positions them there. */
const reminderDateForView = (
  r: ReminderRecord,
  view: StreamView,
  pinnedOnly: boolean,
): number | null => {
  const snoozed = r.snoozeWakeAt !== undefined;
  if (view.type === "inbox") {
    if (r.status !== "active" || snoozed) return null;
    if (pinnedOnly && !r.pinned) return null;
    return r.resurfacedAt ?? r.createdAt;
  }
  if (view.type === "snoozed") {
    return r.status === "active" && snoozed ? r.snoozeWakeAt! : null;
  }
  if (view.type === "done") {
    return r.status === "done" ? r.doneAt ?? r.createdAt : null;
  }
  if (view.type === "reminders") {
    if (r.status !== "active") return null;
    return snoozed ? r.snoozeWakeAt! : r.resurfacedAt ?? r.createdAt;
  }
  return null;
};

export const deriveStream = (
  messagesByKey: Record<string, RawMessage>,
  myEmails: ReadonlySet<string>,
  view: StreamView = { type: "inbox" },
  snoozesByKey: Record<string, SnoozeRecord> = {},
  pinnedOnly = false,
  remindersById: Record<string, ReminderRecord> = {},
  tripsById: Record<string, TripRecord> = {},
  tripMembershipByKey: Record<string, TripMembershipRecord> = {},
  /** Only this account's mail; null for every account. */
  accountId: string | null = null,
): Stream => {
  const allMessages = Object.values(messagesByKey);
  const anchorOrigins: ReadonlySet<MessageOrigin> = new Set(
    view.type === "sent"
      ? ["sent"]
      : view.type === "draft"
        ? ["draft"]
        : view.type === "done"
          ? ["done"]
          : view.type === "bundle" || view.type === "trips"
            ? ["inbox", "done"]
            : ["inbox"],
  );
  const visible = allMessages.filter((m) => {
    if (view.type === "reminders") return false;
    if (view.type === "inbox") {
      return m.origin === "sent" || m.origin === "draft" || (m.origin === "inbox" && !m.snoozed);
    }
    if (view.type === "snoozed") {
      return m.origin === "sent" || m.origin === "draft" || (m.origin === "inbox" && m.snoozed);
    }
    if (view.type === "draft") return m.origin === "draft";
    if (view.type === "sent") return m.origin === "sent";
    if (view.type === "done") return m.origin === "sent" || m.origin === "draft" || m.origin === "done";
    // Both remaining views (bundle, trips) are "the whole thing": done messages
    // count alongside inbox. Trip membership is what selects, not category —
    // manual adds aren't limited to travel-looking mail.
    const belongs =
      view.type === "trips"
        ? tripMembershipByKey[pinKeyOf(m)]?.tripId != null
        : m.category === view.category;
    // A trip is everything booked for it, snoozed mail included — otherwise a
    // trip whose mail is all snoozed would count as empty and vanish.
    const snoozedOk = view.type === "trips" || !m.snoozed;
    return (
      m.origin === "sent" ||
      m.origin === "draft" ||
      ((m.origin === "inbox" || m.origin === "done") && snoozedOk && belongs)
    );
  });
  let threads = buildThreads(visible, myEmails, anchorOrigins);
  if (view.type === "snoozed") {
    threads = threads
      .map((thread) => {
        const dueAt = thread.messages
          .map((m) => snoozesByKey[m.key]?.wakeAt)
          .filter((wakeAt): wakeAt is number => typeof wakeAt === "number")
          .sort((a, b) => a - b)[0];
        return dueAt ? { ...thread, latestDate: dueAt, snoozeDueAt: dueAt } : thread;
      })
      .filter((thread) => typeof thread.snoozeDueAt === "number");
  }
  if (pinnedOnly && view.type === "inbox") {
    threads = threads.filter((t) => t.pinned);
  }
  const showInboxBundles = view.type === "inbox";
  const showTripsView = view.type === "trips";
  // Faithful to Google Inbox: each trip is its own row in the inbox stream,
  // not a slice of the travel bundle.
  const groupTrips = showInboxBundles || showTripsView;
  // Threads never span accounts (see threading.ts), so narrowing to one is a
  // filter on whole threads. Trips are the exception: a trip belongs to every
  // account it has mail from, and shows whole in each, since a flight booked
  // from work and a hotel booked from home are still one trip.
  if (accountId) {
    const accountTrips = new Set(
      threads
        .filter((t) => t.accountId === accountId)
        .map((t) => tripIdOfThread(t, tripMembershipByKey)),
    );
    threads = threads.filter((t) => {
      if (t.accountId === accountId) return true;
      if (!groupTrips || (!showTripsView && t.pinned)) return false;
      const tripId = tripIdOfThread(t, tripMembershipByKey);
      return !!tripId && accountTrips.has(tripId);
    });
  }

  const byCategory = new Map<Category, Thread[]>();
  const byTrip = new Map<string, Thread[]>();
  const personal: Thread[] = [];
  for (const t of threads) {
    // Pinned threads never hide inside a bundle or a trip; they surface
    // individually (the trips view is the exception — a trip card is the
    // whole trip, pinned mail included).
    const canGroupTrip = groupTrips && (showTripsView || !t.pinned);
    // A membership pointing at a deleted trip renders unassigned.
    const tripId = canGroupTrip ? tripIdOfThread(t, tripMembershipByKey) : null;
    if (tripId && tripsById[tripId]) {
      let arr = byTrip.get(tripId);
      if (!arr) {
        arr = [];
        byTrip.set(tripId, arr);
      }
      arr.push(t);
    } else if (showInboxBundles && t.category && !t.pinned) {
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

  const reminderItems: StreamItem[] = [];
  for (const r of Object.values(remindersById)) {
    const date = reminderDateForView(r, view, pinnedOnly);
    if (date !== null) reminderItems.push({ type: "reminder", date, reminder: r });
  }

  // Like every Inbox bundle, a trip with no mail doesn't exist — not in the
  // inbox, and not in the trips view either.
  const tripItems: StreamItem[] = Object.values(tripsById)
    .filter((trip) => (byTrip.get(trip.id)?.length ?? 0) > 0)
    .map((trip) => {
      const sorted = [...(byTrip.get(trip.id) ?? [])].sort(
        (a, b) => b.latestDate - a.latestDate,
      );
      return {
        type: "trip" as const,
        // The trips view orders by when the trip happens; the inbox by its
        // newest mail, like every other row.
        date: showTripsView ? tripWhen(trip).start : (sorted[0]?.latestDate ?? trip.createdAt),
        trip,
        threads: sorted,
      };
    });

  const items: StreamItem[] = [
    ...tripItems,
    ...[...byCategory.entries()].map(([category, ts]) => {
      const sorted = [...ts].sort((a, b) => b.latestDate - a.latestDate);
      return {
        type: "bundle" as const,
        date: sorted[0]?.latestDate ?? 0,
        category,
        threads: sorted,
      };
    }),
    // The trips view is only the list of trip bundles, like real Inbox —
    // unassigned travel mail lives loose in the inbox, not here.
    ...(showTripsView
      ? []
      : personal.map((t) => ({
          type: "thread" as const,
          date: t.latestDate,
          thread: t,
        }))),
    ...reminderItems,
  ].sort((a, b) => view.type === "snoozed" ? a.date - b.date : b.date - a.date);

  const now = Date.now();
  if (showTripsView) {
    // Upcoming (soonest first, including trips under way), then past trips
    // by year, newest first.
    const upcoming: StreamItem[] = [];
    const byYear = new Map<number, StreamItem[]>();
    for (const item of items) {
      if (item.type !== "trip") continue;
      if (tripWhen(item.trip).end >= now) {
        upcoming.push(item);
        continue;
      }
      const year = new Date(item.date).getFullYear();
      byYear.set(year, [...(byYear.get(year) ?? []), item]);
    }
    const sections: StreamSection[] = [
      ...(upcoming.length
        ? [{ label: "Upcoming", items: upcoming.sort((a, b) => a.date - b.date) }]
        : []),
      ...[...byYear.entries()]
        .sort(([a], [b]) => b - a)
        .map(([year, yearItems]) => ({ label: String(year), items: yearItems })),
    ];
    return { sections, threadCount: tripItems.length, view };
  }

  const byBucket = new Map<string, StreamItem[]>();
  for (const item of items) {
    // The reminders view mixes past items with future (snoozed) ones.
    const label =
      view.type === "snoozed" || (view.type === "reminders" && item.date > now)
        ? futureDateBucket(item.date)
        : dateBucket(item.date);
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

  const threadCount = threads.length + reminderItems.length;
  return { sections, threadCount, view };
}

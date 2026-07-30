import { buildThreads } from "../shared/threading";
import { pinKeyOf } from "../shared/pinKey";
import { tripIdOfThread } from "../shared/trips";
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

/** The bundle whose view groups member threads into trip cards. */
export const TRIPS_CATEGORY: Category = "travel";

export const deriveStream = (
  messagesById: Record<number, RawMessage>,
  myEmails: ReadonlySet<string>,
  view: StreamView = { type: "inbox" },
  snoozesByMessageId: Record<number, SnoozeRecord> = {},
  pinnedOnly = false,
  remindersById: Record<string, ReminderRecord> = {},
  tripsById: Record<string, TripRecord> = {},
  tripMembershipByKey: Record<string, TripMembershipRecord> = {},
): Stream => {
  const allMessages = Object.values(messagesById);
  const anchorOrigins: ReadonlySet<MessageOrigin> = new Set(
    view.type === "sent"
      ? ["sent"]
      : view.type === "draft"
        ? ["draft"]
        : view.type === "done"
          ? ["done"]
          : view.type === "bundle"
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
    // The bundle view is the whole bundle: done messages count alongside inbox.
    // The trips bundle additionally pulls in any mail assigned to a trip,
    // whatever its category — manual adds aren't limited to travel mail.
    const inTrip =
      view.category === TRIPS_CATEGORY &&
      tripMembershipByKey[pinKeyOf(m)]?.tripId != null;
    return (
      m.origin === "sent" ||
      m.origin === "draft" ||
      ((m.origin === "inbox" || m.origin === "done") &&
        !m.snoozed &&
        (m.category === view.category || inTrip))
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
  if (pinnedOnly && view.type === "inbox") {
    threads = threads.filter((t) => t.pinned);
  }
  const showInboxBundles = view.type === "inbox";
  const showTripsView = view.type === "bundle" && view.category === TRIPS_CATEGORY;
  // Faithful to Google Inbox: each trip is its own row in the inbox stream,
  // not a slice of the travel bundle.
  const groupTrips = showInboxBundles || showTripsView;

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
    } else if (
      // Like real Inbox, there is no generic travel bundle: travel mail is
      // either in a trip or loose in the inbox. The category survives
      // internally to feed the trips view's unassigned list and extraction.
      showInboxBundles &&
      t.category &&
      t.category !== TRIPS_CATEGORY &&
      !t.pinned
    ) {
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

  // The trips view lists every trip — even with no visible mail — so it can
  // still be renamed or deleted. The inbox only shows trips with live mail.
  const tripItems: StreamItem[] = Object.values(tripsById)
    .filter((trip) => showTripsView || (byTrip.get(trip.id)?.length ?? 0) > 0)
    .map((trip) => {
      const sorted = [...(byTrip.get(trip.id) ?? [])].sort(
        (a, b) => b.latestDate - a.latestDate,
      );
      return {
        type: "trip" as const,
        date: sorted[0]?.latestDate ?? trip.createdAt,
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

  // The trips view renders only trip cards (incl. empty ones); everywhere
  // else, empty trips never render but loose threads do.
  const emptyTripCount = tripItems.filter((item) => item.type === "trip" && !item.threads.length).length;
  const threadCount = showTripsView
    ? tripItems.length
    : threads.length + reminderItems.length + emptyTripCount;
  return { sections, threadCount, view };
}

import { pinKeyOf } from "./pinKey";
import type {
  Thread,
  TripMembershipReason,
  TripMembershipRecord,
  TripRecord,
} from "./types";

/** Membership keys for every message in the thread (see pinKeyOf). */
export const tripKeysOfThread = (thread: Thread): string[] =>
  thread.messages.map((m) => pinKeyOf(m));

/**
 * The membership deciding where a thread sits. A thread joins a trip when any
 * of its messages has a membership; if messages disagree, the most recent
 * assignment wins (tombstones included, so a later "remove" beats an earlier
 * add).
 */
export const tripMembershipOfThread = (
  thread: Thread,
  membershipByKey: Record<string, TripMembershipRecord>,
): TripMembershipRecord | null => {
  let latest: TripMembershipRecord | null = null;
  for (const key of tripKeysOfThread(thread)) {
    const record = membershipByKey[key];
    if (record && (!latest || record.addedAt > latest.addedAt)) latest = record;
  }
  return latest;
}

/** The trip a thread belongs to, or null. */
export const tripIdOfThread = (
  thread: Thread,
  membershipByKey: Record<string, TripMembershipRecord>,
): string | null => tripMembershipOfThread(thread, membershipByKey)?.tripId ?? null;

/**
 * One line explaining why a message is in its trip. The clusterer records the
 * reason at join time; anything written before it did so reads as a plain
 * automatic add until the next recluster backfills it.
 */
export const describeTripReason = (
  reason: TripMembershipReason | undefined,
): string => {
  switch (reason?.kind) {
    case "reservation":
      return reason.detail
        ? `Reservation found in this message — ${reason.detail}`
        : "A reservation was found in this message";
    case "code-match":
      return reason.detail
        ? `Shares confirmation ${reason.detail} with this trip`
        : "Shares a confirmation code with this trip";
    case "date-range":
      return "Its dates fall inside this trip";
    case "return-leg":
      return reason.detail
        ? `Booked as the flight home — ${reason.detail}`
        : "Booked as the flight home";
    case "manual":
      return "You added this to the trip";
    default:
      return "Added automatically";
  }
}

/**
 * Display date range for a trip: explicit travel dates when extraction
 * (phase 2) has set them, otherwise the span of member mail.
 */
export const tripDateRange = (
  trip: TripRecord,
  threads: readonly Thread[],
): { start: number; end: number } | null => {
  if (trip.startDate && trip.endDate) return { start: trip.startDate, end: trip.endDate };
  let start = Infinity;
  let end = -Infinity;
  for (const t of threads) {
    for (const m of t.messages) {
      if (m.date < start) start = m.date;
      if (m.date > end) end = m.date;
    }
  }
  return end >= start ? { start, end } : null;
}

/**
 * Inbox's trip dates, always with the year: "Aug 13, 2017",
 * "Aug 25–27, 2017", "Jul 26–Aug 3, 2017", "Dec 22, 2018–Jan 4, 2019".
 */
export const formatTripRange = (range: { start: number; end: number }): string => {
  const start = new Date(range.start);
  const end = new Date(range.end);
  const month = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth && start.getDate() === end.getDate()) {
    return `${month(end)} ${end.getDate()}, ${end.getFullYear()}`;
  }
  if (sameMonth) {
    return `${month(start)} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
  }
  const head = `${month(start)} ${start.getDate()}${sameYear ? "" : `, ${start.getFullYear()}`}`;
  return `${head}–${month(end)} ${end.getDate()}, ${end.getFullYear()}`;
}

const DAY = 24 * 60 * 60 * 1000;
/** A trip this close to an email's date is a plausible home for it. */
const NEARBY = 30 * DAY;

/** When a trip happens: its travel dates, or when it was made for manual trips. */
export const tripWhen = (trip: TripRecord): { start: number; end: number } => ({
  start: trip.startDate ?? trip.createdAt,
  end: trip.endDate ?? trip.startDate ?? trip.createdAt,
});

/**
 * The few trips worth offering in Move to: the one the thread is already in,
 * then trips near the thread's own dates, then upcoming ones. Everything else
 * is behind "More trips…" — with years of extracted history, listing every
 * trip made the menu useless.
 */
export const suggestTrips = (
  trips: readonly TripRecord[],
  thread: Thread,
  currentTripId: string | null,
  now: number,
  limit = 3,
): TripRecord[] => {
  const distance = (trip: TripRecord): number => {
    const { start, end } = tripWhen(trip);
    const at = thread.latestDate;
    return at < start ? start - at : at > end ? at - end : 0;
  };
  const current = trips.find((t) => t.id === currentTripId);
  const nearby = trips
    .filter((t) => t !== current && distance(t) <= NEARBY)
    .sort((a, b) => distance(a) - distance(b));
  const upcoming = trips
    .filter((t) => t !== current && !nearby.includes(t) && tripWhen(t).end >= now - DAY)
    .sort((a, b) => tripWhen(a).start - tripWhen(b).start);
  return [...(current ? [current] : []), ...nearby, ...upcoming].slice(0, limit);
};

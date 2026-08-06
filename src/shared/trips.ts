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

const DAY_WITH_YEAR: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
const DAY_ONLY: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

export const formatTripRange = (range: { start: number; end: number }): string => {
  const start = new Date(range.start);
  const end = new Date(range.end);
  const thisYear = new Date().getFullYear();
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  const endOpts = end.getFullYear() === thisYear ? DAY_ONLY : DAY_WITH_YEAR;
  if (sameDay) return end.toLocaleDateString("en-US", endOpts);
  const startOpts =
    start.getFullYear() === end.getFullYear() ? DAY_ONLY : DAY_WITH_YEAR;
  return `${start.toLocaleDateString("en-US", startOpts)} – ${end.toLocaleDateString("en-US", endOpts)}`;
}

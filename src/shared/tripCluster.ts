/**
 * Auto-clustering: turns extracted reservations into trips. Pure — takes the
 * current reservations/trips/memberships and returns the writes to apply, so
 * it can run anywhere and be reasoned about without Dexie in the picture.
 *
 * Ground rules (agreed with Dan, phase 1):
 *  - Manual membership rows are untouchable, including tripId-null tombstones.
 *  - Only flights, lodging, trains, and rentals CREATE trips; dining/event
 *    reservations, cancellations, and code-only mail (check-in reminders,
 *    receipts) only ATTACH to a trip that already claims their code or dates.
 *  - Never rename a trip with nameIsCustom.
 */
import { cityOfAirport, isKnownAirport } from "./airports";
import type {
  ReservationRecord,
  TripMembershipReason,
  TripMembershipRecord,
  TripRecord,
} from "./types";

const DAY = 24 * 60 * 60 * 1000;
/** Reservations whose date spans come this close belong to the same trip. */
const CLUSTER_GAP = 3 * DAY;
/** A flight home closes a trip even when the gap heuristic can't see it. */
const RETURN_WINDOW = 21 * DAY;
/** Dining/event reservations attach when they fall inside the trip ± this. */
const ATTACH_SLACK = 1 * DAY;
/**
 * No join — date-gap, return-leg, or shared-code — may stretch a cluster's
 * envelope past this. Applies even to shared codes: airline PNRs are just 6
 * characters and get recycled once a booking ages out, so a code match years
 * apart is much more likely reuse than the same trip. And chained nearest-
 * neighbor date joins (each link legitimately within CLUSTER_GAP of the
 * last) can drift indefinitely if enough links exist regardless. This is the
 * backstop against both, independent of what's feeding the chain.
 */
const MAX_TRIP_SPAN = 45 * DAY;

const TRIP_CREATING = new Set(["flight", "lodging", "train", "rental"]);

export interface TripClusterInput {
  reservations: readonly ReservationRecord[];
  tripsById: Readonly<Record<string, TripRecord>>;
  membershipByKey: Readonly<Record<string, TripMembershipRecord>>;
  now: number;
}

export interface TripClusterResult {
  tripsToPut: TripRecord[];
  /** Auto-created trips reclustering emptied out entirely. */
  tripIdsToDelete: string[];
  membershipsToPut: TripMembershipRecord[];
  /** Stale auto rows: reservations reclustering no longer places anywhere. */
  membershipKeysToDelete: string[];
}

interface Cluster {
  /** Envelope over all members — display only; never used for join decisions. */
  start: number;
  end: number;
  /**
   * Each member's own span, checked individually for date-gap joins. The
   * envelope alone isn't safe for that: one legitimate multi-week trip
   * stretches [start, end] forward, and after that any later, wholly
   * unrelated reservation satisfies "close to the envelope" even though it
   * isn't close to anything the trip actually contains — that's how a single
   * bad merge snowballed into a 240-member, 7-year "trip" against Dan's real
   * mailbox. Testing against the nearest actual member closes that hole.
   */
  spans: { start: number; end: number }[];
  keys: string[];
  /**
   * Why each key joined, captured at the moment the join decision is made —
   * it cannot be recovered afterwards without re-running the whole pass, and
   * the UI needs it to answer "why is this in my trip?".
   */
  reasons: Map<string, TripMembershipReason>;
  codes: Set<string>;
  airports: Set<string>;
  /** kind/destination pairs feeding the trip name. */
  flightDests: string[];
  textDests: string[];
  /** Every flight leg, so naming can tell a stopover from a layover. */
  legs: FlightLeg[];
}

interface FlightLeg {
  origin?: string;
  destination: string;
  start: number;
  end?: number;
}

/** The reservation itself, phrased for a one-line "why" chip. */
const describeReservation = (r: ReservationRecord): string | undefined => {
  const summary = r.segments.find((s) => s.summary)?.summary;
  if (summary) return summary;
  const kind = r.segments[0]?.kind;
  return kind ? `${kind} reservation` : undefined;
};

const sharedCodeWith = (c: Cluster, r: ReservationRecord): string | undefined =>
  r.confirmationCodes.find((code) => c.codes.has(code));

const spanOf = (r: ReservationRecord): { start: number; end: number } | null => {
  let start = Infinity;
  let end = -Infinity;
  for (const s of r.segments) {
    if (s.start < start) start = s.start;
    const e = s.end ?? s.start;
    if (e > end) end = e;
  }
  return end >= start ? { start, end } : null;
};

const createsTrips = (r: ReservationRecord): boolean =>
  r.status === "extracted" && r.segments.some((s) => TRIP_CREATING.has(s.kind));

/**
 * The airport that shows up in nearly every itinerary is where the traveler
 * lives; everything else is a destination.
 */
export const inferHomeAirport = (
  reservations: readonly ReservationRecord[],
): string | null => {
  const counts = new Map<string, number>();
  for (const r of reservations) {
    const seen = new Set<string>();
    for (const s of r.segments) {
      if (s.kind !== "flight") continue;
      for (const code of [s.origin, s.destination]) {
        if (code && isKnownAirport(code)) seen.add(code);
      }
    }
    // Count per reservation, not per segment: a one-stop itinerary mentions
    // the connection twice but home only proves itself across bookings.
    for (const code of seen) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 1; // a single appearance proves nothing
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
};

const addReservationToCluster = (
  c: Cluster,
  r: ReservationRecord,
  reason: TripMembershipReason,
): void => {
  const span = spanOf(r);
  if (span) {
    if (span.start < c.start) c.start = span.start;
    if (span.end > c.end) c.end = span.end;
    c.spans.push(span);
  }
  c.keys.push(r.key);
  c.reasons.set(r.key, reason);
  for (const code of r.confirmationCodes) c.codes.add(code);
  for (const s of r.segments) {
    if (s.kind === "flight") {
      for (const code of [s.origin, s.destination]) {
        if (code && isKnownAirport(code)) c.airports.add(code);
      }
      if (s.destination && isKnownAirport(s.destination)) {
        c.flightDests.push(s.destination);
        c.legs.push({ origin: s.origin, destination: s.destination, start: s.start, end: s.end });
      }
    } else if (s.destination) {
      c.textDests.push(s.destination);
    }
  }
};

const sharesCode = (c: Cluster, r: ReservationRecord): boolean =>
  r.confirmationCodes.some((code) => c.codes.has(code));

/** True when span comes within CLUSTER_GAP of at least one actual member. */
const nearAnyMember = (c: Cluster, span: { start: number; end: number }): boolean =>
  c.spans.some((m) => span.start <= m.end + CLUSTER_GAP && span.end >= m.start - CLUSTER_GAP);

/** Would folding span into c's envelope stretch it past the trip-length cap? */
const withinSpanCap = (c: Cluster, span: { start: number; end: number }): boolean =>
  Math.max(c.end, span.end) - Math.min(c.start, span.start) <= MAX_TRIP_SPAN;

/**
 * A cluster sharing a code with r, but only within the span cap — airline
 * PNRs are 6 characters and airlines recycle them once a booking ages out,
 * so a code match years apart is much more likely reuse than the same trip.
 * Both callers (the trip-creating pass and the attach-only pass) must route
 * their code check through this, not a bare sharesCode lookup: a bare lookup
 * bypasses the cap entirely, which is exactly how a single stray recycled
 * code kept re-forming a multi-year blob even after the cap landed inside
 * joinable() — these callers never went through joinable for their initial
 * code match, so the cap in there never ran.
 */
const clusterSharingCode = (
  clusters: readonly Cluster[],
  r: ReservationRecord,
  span: { start: number; end: number } | null,
): Cluster | null => {
  for (const c of clusters) {
    if (!sharesCode(c, r)) continue;
    if (span && !withinSpanCap(c, span)) continue;
    return c;
  }
  return null;
};

/** The reason this reservation may join the cluster, or null if it may not. */
const joinable = (
  c: Cluster,
  r: ReservationRecord,
  span: { start: number; end: number },
  home: string | null,
): TripMembershipReason | null => {
  if (nearAnyMember(c, span) && withinSpanCap(c, span)) return { kind: "date-range" };
  // Return leg booked separately: it flies HOME from an airport this trip
  // visited, reasonably soon after the trip's last known date. Both ends
  // matter — home is in every trip's airport set, so without excluding it,
  // each new departure from home chained onto the previous trip and years of
  // travel collapsed into one blob (seen in Dan's real mailbox). "The trip's
  // last known date" means the nearest actual member, not the envelope —
  // the envelope grows with every merge and stops meaning "recent."
  if (!home) return null;
  for (const s of r.segments) {
    if (s.kind !== "flight" || !s.origin || s.destination !== home) continue;
    if (s.origin === home || !c.airports.has(s.origin)) continue;
    const nearReturn = c.spans.some(
      (m) => span.start > m.end && span.start <= m.end + RETURN_WINDOW,
    );
    if (nearReturn && withinSpanCap(c, span)) {
      return { kind: "return-leg", detail: s.summary ?? `${s.origin} → ${home}` };
    }
  }
  return null;
};

const mostCommon = (values: readonly string[]): string | null => {
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestCount = 0;
  for (const v of values) {
    const count = (counts.get(v) ?? 0) + 1;
    counts.set(v, count);
    if (count > bestCount) {
      best = v;
      bestCount = count;
    }
  }
  return best;
};

/** Under this long on the ground before flying on, a stop is a connection. */
const CONNECTION_WINDOW = 1 * DAY;

/**
 * Places the trip actually stayed, in the order it reached them: flight
 * destinations, minus home and minus connections (another leg leaves from
 * there within CONNECTION_WINDOW of arriving). Text extractors only give
 * dates, so a same-day onward flight reads as a connection too.
 */
const stopsOf = (c: Cluster, home: string | null): string[] => {
  const legs = [...c.legs].sort((a, b) => a.start - b.start);
  const stops: string[] = [];
  for (const leg of legs) {
    if (leg.destination === home) continue;
    const arrived = leg.end ?? leg.start;
    const connection = legs.some(
      (next) =>
        next !== leg &&
        next.origin === leg.destination &&
        next.destination !== leg.origin &&
        next.start >= leg.start &&
        next.start - arrived < CONNECTION_WINDOW,
    );
    if (connection) continue;
    const city = cityOfAirport(leg.destination);
    if (!stops.includes(city)) stops.push(city);
  }
  return stops;
};

/** Leaves Friday or Saturday, back by Monday: Inbox called that a weekend. */
const isWeekend = (c: Cluster): boolean => {
  if (c.end - c.start > 3 * DAY) return false;
  const leaves = new Date(c.start).getDay();
  const returns = new Date(c.end).getDay();
  return (leaves === 5 || leaves === 6) && (returns === 0 || returns === 1 || returns === leaves);
};

/** Inbox's phrasing: "Trip to A", "Trip to A & B", "Trip to A, B & others". */
const nameForPlaces = (places: readonly string[], weekend: boolean): string => {
  const [first, second] = places;
  if (places.length === 1) return weekend ? `Weekend in ${first}` : `Trip to ${first}`;
  if (places.length === 2) return `Trip to ${first} & ${second}`;
  return `Trip to ${first}, ${second} & others`;
};

const nameOf = (c: Cluster, inferredHome: string | null): string => {
  const weekend = isWeekend(c);
  // Too little history to know home: the trip starts from there, then.
  const firstLeg = [...c.legs].sort((a, b) => a.start - b.start)[0];
  const home = inferredHome ?? firstLeg?.origin ?? null;
  const stops = stopsOf(c, home);
  if (stops.length) return nameForPlaces(stops, weekend);
  // Every leg looked like a connection (or flew home): fall back to the most
  // visited airport so the trip still gets a place name.
  const away = c.flightDests.filter((code) => code !== home);
  const flightPick = mostCommon(away.length ? away : [...c.airports].filter((a) => a !== home));
  if (flightPick) return nameForPlaces([cityOfAirport(flightPick)], weekend);
  const textPick = mostCommon(c.textDests);
  if (textPick) return nameForPlaces([textPick], weekend);
  return "Trip";
};

export const clusterTrips = (input: TripClusterInput): TripClusterResult => {
  const { reservations, tripsById, membershipByKey, now } = input;

  // Keys the user has spoken for — assignments and tombstones both final.
  const isManual = (key: string): boolean =>
    membershipByKey[key]?.source === "manual";

  const creators = reservations
    .filter((r) => createsTrips(r) && !isManual(r.key))
    .map((r) => ({ r, span: spanOf(r) }))
    .filter((x): x is { r: ReservationRecord; span: { start: number; end: number } } => x.span !== null)
    .sort((a, b) => a.span.start - b.span.start);

  const home = inferHomeAirport(reservations);
  const clusters: Cluster[] = [];
  for (const { r, span } of creators) {
    let target = clusterSharingCode(clusters, r, span);
    // Read the shared code before addReservationToCluster folds r's own codes
    // into the cluster, or every join would report matching itself.
    let reason: TripMembershipReason | null = target
      ? { kind: "code-match", detail: sharedCodeWith(target, r) }
      : null;
    if (!target) {
      for (const c of clusters) {
        const joined = joinable(c, r, span, home);
        if (joined) {
          target = c;
          reason = joined;
          break;
        }
      }
    }
    if (!target) {
      target = {
        start: span.start,
        end: span.end,
        spans: [],
        keys: [],
        reasons: new Map(),
        codes: new Set(),
        airports: new Set(),
        flightDests: [],
        textDests: [],
        legs: [],
      };
      clusters.push(target);
      reason = { kind: "reservation", detail: describeReservation(r) };
    }
    addReservationToCluster(target, r, reason ?? { kind: "reservation" });
  }

  // Attach-only pass: cancellations, dining/events, and code-only mail join
  // by shared code, or (dated reservations) by falling inside the trip span.
  const attachments = reservations.filter(
    (r) => !isManual(r.key) && !clusters.some((c) => c.keys.includes(r.key)),
  );
  for (const r of attachments) {
    const attachSpan = spanOf(r);
    let target = clusterSharingCode(clusters, r, attachSpan);
    let reason: TripMembershipReason | null = target
      ? { kind: "code-match", detail: sharedCodeWith(target, r) }
      : null;
    if (!target && r.status !== "none") {
      const span = attachSpan;
      if (span) {
        target =
          clusters.find(
            (c) => span.start >= c.start - ATTACH_SLACK && span.end <= c.end + ATTACH_SLACK,
          ) ?? null;
        if (target) reason = { kind: "date-range" };
      }
    }
    if (target && reason) {
      target.keys.push(r.key);
      target.reasons.set(r.key, reason);
    }
  }

  // Map clusters onto trips: any member already assigned to a live trip
  // (auto or manual) votes to reuse it, keeping trip ids stable across
  // reclusters. Each trip is claimed once, in chronological cluster order.
  const claimed = new Set<string>();
  const tripsToPut = new Map<string, TripRecord>();
  const membershipsToPut: TripMembershipRecord[] = [];
  const assignedKeys = new Set<string>();

  for (const c of clusters) {
    const votes = c.keys
      .map((key) => membershipByKey[key]?.tripId)
      .filter((id): id is string => !!id && !!tripsById[id] && !claimed.has(id));
    const reusedId = mostCommon(votes);
    const tripId = reusedId ?? crypto.randomUUID();
    claimed.add(tripId);

    const existing = tripsById[tripId];
    const name = nameOf(c, home);
    const next: TripRecord = existing
      ? {
          ...existing,
          name: existing.nameIsCustom ? existing.name : name,
          startDate: c.start,
          endDate: c.end,
        }
      : {
          id: tripId,
          name,
          nameIsCustom: false,
          createdAt: now,
          startDate: c.start,
          endDate: c.end,
        };
    if (
      !existing ||
      existing.name !== next.name ||
      existing.startDate !== next.startDate ||
      existing.endDate !== next.endDate
    ) {
      tripsToPut.set(tripId, next);
    }

    for (const key of c.keys) {
      assignedKeys.add(key);
      const current = membershipByKey[key];
      if (current?.source === "manual") continue; // filtered above, belt+braces
      // Rows written before reasons existed are rewritten once to backfill
      // one; after that an unchanged assignment is left alone.
      if (current?.tripId === tripId && current.reason) continue;
      membershipsToPut.push({
        key,
        tripId,
        source: "auto",
        addedAt: now,
        reason: c.reasons.get(key),
      });
    }
  }

  // Auto rows for reservations we manage that no cluster wants anymore
  // (extraction changed, trip dissolved) are stale — drop them.
  const managedKeys = new Set(reservations.map((r) => r.key));
  const membershipKeysToDelete: string[] = [];
  for (const [key, record] of Object.entries(membershipByKey)) {
    if (record.source !== "auto") continue;
    if (!managedKeys.has(key)) continue;
    if (assignedKeys.has(key)) continue;
    membershipKeysToDelete.push(key);
  }

  // GC every trip this diff leaves with no members at all, the way Google
  // Inbox did: emptying a trip deleted it rather than leaving a shell behind.
  // A custom name and manual members used to buy a trip immunity here, which
  // only meant the trips view silently accumulated empties the user then had
  // to delete by hand.
  //
  // "No members" is counted over membership rows, never over threads visible
  // in some view — snoozed and archived mail still belong to their trip.
  const deletedKeys = new Set(membershipKeysToDelete);
  const postCounts = new Map<string, number>();
  for (const [key, record] of Object.entries(membershipByKey)) {
    const overridden = deletedKeys.has(key) || membershipsToPut.some((m) => m.key === key);
    if (!overridden && record.tripId) {
      postCounts.set(record.tripId, (postCounts.get(record.tripId) ?? 0) + 1);
    }
  }
  for (const m of membershipsToPut) {
    if (m.tripId) postCounts.set(m.tripId, (postCounts.get(m.tripId) ?? 0) + 1);
  }
  const tripIdsToDelete = Object.values(tripsById)
    .filter((t) => !(postCounts.get(t.id) ?? 0) && !tripsToPut.has(t.id))
    .map((t) => t.id);

  return {
    tripsToPut: [...tripsToPut.values()],
    tripIdsToDelete,
    membershipsToPut,
    membershipKeysToDelete,
  };
};

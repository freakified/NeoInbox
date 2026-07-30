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
  codes: Set<string>;
  airports: Set<string>;
  /** kind/destination pairs feeding the trip name. */
  flightDests: string[];
  textDests: string[];
}

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

const addReservationToCluster = (c: Cluster, r: ReservationRecord): void => {
  const span = spanOf(r);
  if (span) {
    if (span.start < c.start) c.start = span.start;
    if (span.end > c.end) c.end = span.end;
    c.spans.push(span);
  }
  c.keys.push(r.key);
  for (const code of r.confirmationCodes) c.codes.add(code);
  for (const s of r.segments) {
    if (s.kind === "flight") {
      for (const code of [s.origin, s.destination]) {
        if (code && isKnownAirport(code)) c.airports.add(code);
      }
      if (s.destination && isKnownAirport(s.destination)) {
        c.flightDests.push(s.destination);
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

const joinable = (
  c: Cluster,
  r: ReservationRecord,
  span: { start: number; end: number },
  home: string | null,
): boolean => {
  if (nearAnyMember(c, span) && withinSpanCap(c, span)) return true;
  // Return leg booked separately: it flies HOME from an airport this trip
  // visited, reasonably soon after the trip's last known date. Both ends
  // matter — home is in every trip's airport set, so without excluding it,
  // each new departure from home chained onto the previous trip and years of
  // travel collapsed into one blob (seen in Dan's real mailbox). "The trip's
  // last known date" means the nearest actual member, not the envelope —
  // the envelope grows with every merge and stops meaning "recent."
  if (!home) return false;
  for (const s of r.segments) {
    if (s.kind !== "flight" || !s.origin || s.destination !== home) continue;
    if (s.origin === home || !c.airports.has(s.origin)) continue;
    const nearReturn = c.spans.some(
      (m) => span.start > m.end && span.start <= m.end + RETURN_WINDOW,
    );
    if (nearReturn && withinSpanCap(c, span)) return true;
  }
  return false;
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

const nameOf = (c: Cluster, home: string | null): string => {
  const away = c.flightDests.filter((code) => code !== home);
  const flightPick = mostCommon(away.length ? away : [...c.airports].filter((a) => a !== home));
  if (flightPick) return `Trip to ${cityOfAirport(flightPick)}`;
  const textPick = mostCommon(c.textDests);
  if (textPick) return `Trip to ${textPick}`;
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
    if (!target) {
      for (const c of clusters) {
        if (joinable(c, r, span, home)) {
          target = c;
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
        codes: new Set(),
        airports: new Set(),
        flightDests: [],
        textDests: [],
      };
      clusters.push(target);
    }
    addReservationToCluster(target, r);
  }

  // Attach-only pass: cancellations, dining/events, and code-only mail join
  // by shared code, or (dated reservations) by falling inside the trip span.
  const attachments = reservations.filter(
    (r) => !isManual(r.key) && !clusters.some((c) => c.keys.includes(r.key)),
  );
  for (const r of attachments) {
    const attachSpan = spanOf(r);
    let target = clusterSharingCode(clusters, r, attachSpan);
    if (!target && r.status !== "none") {
      const span = attachSpan;
      if (span) {
        target =
          clusters.find(
            (c) => span.start >= c.start - ATTACH_SLACK && span.end <= c.end + ATTACH_SLACK,
          ) ?? null;
      }
    }
    if (target) target.keys.push(r.key);
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
      if (current?.tripId === tripId) continue;
      membershipsToPut.push({ key, tripId, source: "auto", addedAt: now });
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

  // GC trips this clusterer created and has now fully emptied: previously
  // fed by auto rows, zero members after this diff applies, and never
  // touched by the user (no custom name, no manual member — those are
  // theirs to keep or delete).
  const deletedKeys = new Set(membershipKeysToDelete);
  const postCounts = new Map<string, number>();
  const preAutoTripIds = new Set<string>();
  for (const [key, record] of Object.entries(membershipByKey)) {
    if (record.source === "auto" && record.tripId) preAutoTripIds.add(record.tripId);
    const overridden = deletedKeys.has(key) || membershipsToPut.some((m) => m.key === key);
    if (!overridden && record.tripId) {
      postCounts.set(record.tripId, (postCounts.get(record.tripId) ?? 0) + 1);
    }
  }
  for (const m of membershipsToPut) {
    if (m.tripId) postCounts.set(m.tripId, (postCounts.get(m.tripId) ?? 0) + 1);
  }
  const tripIdsToDelete = Object.values(tripsById)
    .filter(
      (t) =>
        !t.nameIsCustom &&
        preAutoTripIds.has(t.id) &&
        !(postCounts.get(t.id) ?? 0) &&
        !tripsToPut.has(t.id),
    )
    .map((t) => t.id);

  return {
    tripsToPut: [...tripsToPut.values()],
    tripIdsToDelete,
    membershipsToPut,
    membershipKeysToDelete,
  };
};

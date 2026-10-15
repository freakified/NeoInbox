/**
 * Clusterer tests. clusterTrips is pure — reservations, trips and memberships
 * in, the writes to apply out — so this needs no database and no fake
 * Thunderbird.
 *
 * Scope is the two things the trips-UX work changed: the join reason recorded
 * on every membership, and deleting a trip the moment it has no members. The
 * older heuristics (span caps, return legs, home-airport inference) are
 * exercised only where they decide which reason gets recorded.
 */
import { describe, expect, it } from "vitest";
import { clusterTrips } from "./tripCluster";
import type {
  ReservationRecord,
  ReservationSegment,
  TripMembershipRecord,
  TripRecord,
} from "./types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 2, 1);

const reservation = (over: Partial<ReservationRecord> = {}): ReservationRecord => ({
  key: `<r${Math.random().toString(36).slice(2)}@example.com>`,
  messageDate: NOW,
  senderDomain: "united.com",
  extractorVersion: 1,
  extractor: "united",
  status: "extracted",
  segments: [],
  confirmationCodes: [],
  scannedAt: NOW,
  ...over,
});

const flight = (over: Partial<ReservationSegment> = {}): ReservationSegment => ({
  kind: "flight",
  start: NOW + 10 * DAY,
  origin: "SFO",
  destination: "NRT",
  summary: "UA 837 SFO → NRT",
  ...over,
});

const cluster = (
  reservations: ReservationRecord[],
  tripsById: Record<string, TripRecord> = {},
  membershipByKey: Record<string, TripMembershipRecord> = {},
) => clusterTrips({ reservations, tripsById, membershipByKey, now: NOW });

const reasonFor = (
  result: ReturnType<typeof clusterTrips>,
  key: string,
): TripMembershipRecord["reason"] =>
  result.membershipsToPut.find((m) => m.key === key)?.reason;

describe("join reasons", () => {
  it("records the reservation that seeded a trip", () => {
    const r = reservation({ key: "<seed@x>", segments: [flight()] });
    const result = cluster([r]);

    expect(reasonFor(result, "<seed@x>")).toEqual({
      kind: "reservation",
      detail: "UA 837 SFO → NRT",
    });
  });

  it("records the shared code when one reservation joins another by locator", () => {
    const seed = reservation({
      key: "<seed@x>",
      segments: [flight()],
      confirmationCodes: ["ABC123"],
    });
    // Far outside CLUSTER_GAP, so only the shared code can pull it in.
    const late = reservation({
      key: "<late@x>",
      segments: [flight({ start: NOW + 30 * DAY, destination: "HND" })],
      confirmationCodes: ["ABC123"],
    });
    const result = cluster([seed, late]);

    expect(reasonFor(result, "<late@x>")).toEqual({
      kind: "code-match",
      detail: "ABC123",
    });
  });

  it("never reports a reservation as matching its own code", () => {
    // The detail is read before the reservation's codes fold into the cluster;
    // read it after and every seed would claim to match itself.
    const r = reservation({
      key: "<seed@x>",
      segments: [flight()],
      confirmationCodes: ["ABC123"],
    });

    expect(reasonFor(cluster([r]), "<seed@x>")).toEqual({
      kind: "reservation",
      detail: "UA 837 SFO → NRT",
    });
  });

  it("records a date-range join for a booking that falls beside another", () => {
    const seed = reservation({ key: "<seed@x>", segments: [flight()] });
    const hotel = reservation({
      key: "<hotel@x>",
      senderDomain: "marriott.com",
      segments: [
        {
          kind: "lodging",
          start: NOW + 11 * DAY,
          end: NOW + 14 * DAY,
          destination: "Tokyo",
          summary: "Hyatt Regency Tokyo",
        },
      ],
    });
    const result = cluster([seed, hotel]);

    expect(reasonFor(result, "<hotel@x>")).toEqual({ kind: "date-range" });
  });

  it("backfills a reason onto a row written before reasons existed", () => {
    const r = reservation({ key: "<seed@x>", segments: [flight()] });
    const trip: TripRecord = {
      id: "trip-1",
      name: "Trip to Tokyo",
      nameIsCustom: false,
      createdAt: NOW,
    };
    const legacy: TripMembershipRecord = {
      key: "<seed@x>",
      tripId: "trip-1",
      source: "auto",
      addedAt: NOW,
    };
    const result = cluster([r], { "trip-1": trip }, { "<seed@x>": legacy });

    expect(reasonFor(result, "<seed@x>")?.kind).toBe("reservation");
  });

  it("leaves an unchanged assignment that already has a reason alone", () => {
    const r = reservation({ key: "<seed@x>", segments: [flight()] });
    const trip: TripRecord = {
      id: "trip-1",
      name: "Trip to Tokyo",
      nameIsCustom: false,
      createdAt: NOW,
    };
    const current: TripMembershipRecord = {
      key: "<seed@x>",
      tripId: "trip-1",
      source: "auto",
      addedAt: NOW,
      reason: { kind: "reservation", detail: "UA 837 SFO → NRT" },
    };
    const result = cluster([r], { "trip-1": trip }, { "<seed@x>": current });

    expect(result.membershipsToPut).toHaveLength(0);
  });
});

describe("empty trips", () => {
  const emptyTrip = (over: Partial<TripRecord> = {}): TripRecord => ({
    id: "trip-1",
    name: "Trip to Tokyo",
    nameIsCustom: false,
    createdAt: NOW,
    ...over,
  });

  it("deletes a trip nothing points at anymore", () => {
    const result = cluster([], { "trip-1": emptyTrip() }, {});
    expect(result.tripIdsToDelete).toEqual(["trip-1"]);
  });

  it("deletes an empty trip even when the user renamed it", () => {
    // A custom name used to buy immunity, which only meant the trips view
    // accumulated shells the user had to delete by hand.
    const result = cluster(
      [],
      { "trip-1": emptyTrip({ name: "Japan 2026", nameIsCustom: true }) },
      {},
    );
    expect(result.tripIdsToDelete).toEqual(["trip-1"]);
  });

  it("deletes a trip whose every member was removed by hand", () => {
    // Tombstones (tripId null) are membership rows, but they point at nothing.
    const tombstone: TripMembershipRecord = {
      key: "<gone@x>",
      tripId: null,
      source: "manual",
      addedAt: NOW,
    };
    const result = cluster([], { "trip-1": emptyTrip() }, { "<gone@x>": tombstone });

    expect(result.tripIdsToDelete).toEqual(["trip-1"]);
  });

  it("keeps a trip held together only by a manual membership", () => {
    // No reservation backs this row — the user filed the mail by hand — so
    // the clusterer must not mistake "I can't re-derive it" for "it's empty".
    const manual: TripMembershipRecord = {
      key: "<byhand@x>",
      tripId: "trip-1",
      source: "manual",
      addedAt: NOW,
    };
    const result = cluster([], { "trip-1": emptyTrip() }, { "<byhand@x>": manual });

    expect(result.tripIdsToDelete).toEqual([]);
  });

  it("does not delete every trip on a run that extracted nothing", () => {
    // Sweeps can legitimately produce zero reservations (nothing new to scan).
    // That must not read as "no trip has any members".
    const auto: TripMembershipRecord = {
      key: "<auto@x>",
      tripId: "trip-1",
      source: "auto",
      addedAt: NOW,
    };
    const result = cluster([], { "trip-1": emptyTrip() }, { "<auto@x>": auto });

    expect(result.tripIdsToDelete).toEqual([]);
  });
});

describe("trip names", () => {
  // Local dates: weekend detection reads the day of week where the user is.
  const WED = new Date(2026, 2, 4).getTime();
  const FRI = new Date(2026, 2, 6).getTime();
  const nameFor = (segments: ReservationSegment[]) =>
    cluster([reservation({ segments })]).tripsToPut[0]?.name;

  it("names a two-city trip after both stops, in travel order", () => {
    expect(
      nameFor([
        flight({ start: WED, origin: "SFO", destination: "EWR", summary: undefined }),
        flight({ start: WED + 4 * DAY, origin: "EWR", destination: "BOS", summary: undefined }),
        flight({ start: WED + 9 * DAY, origin: "BOS", destination: "SFO", summary: undefined }),
      ]),
    ).toBe("Trip to New York & Boston");
  });

  it("skips connections", () => {
    expect(
      nameFor([
        flight({ start: WED, end: WED + 3 * 3_600_000, origin: "SFO", destination: "ORD" }),
        flight({ start: WED + 5 * 3_600_000, origin: "ORD", destination: "BOS" }),
        flight({ start: WED + 7 * DAY, origin: "BOS", destination: "SFO" }),
      ]),
    ).toBe("Trip to Boston");
  });

  it("collapses three or more stops into “& others”", () => {
    expect(
      nameFor([
        flight({ start: WED, origin: "SFO", destination: "EWR" }),
        flight({ start: WED + 2 * DAY, origin: "EWR", destination: "BOS" }),
        flight({ start: WED + 4 * DAY, origin: "BOS", destination: "ORD" }),
        flight({ start: WED + 6 * DAY, origin: "ORD", destination: "SFO" }),
      ]),
    ).toBe("Trip to New York, Boston & others");
  });

  it("calls a Friday-to-Sunday trip a weekend", () => {
    expect(
      nameFor([
        flight({ start: FRI, origin: "SFO", destination: "BOS" }),
        flight({ start: FRI + 2 * DAY, origin: "BOS", destination: "SFO" }),
      ]),
    ).toBe("Weekend in Boston");
  });
});

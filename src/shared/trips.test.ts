import { describe, expect, it } from "vitest";
import { suggestTrips, tripIdOfThread, tripMembershipOfThread } from "./trips";
import type { RawMessage, Thread, TripMembershipRecord } from "./types";

const NOW = Date.UTC(2026, 2, 1);

const message = (headerMessageId: string): RawMessage =>
  ({ key: "k1", tbId: 1, headerMessageId }) as RawMessage;

const thread = (...ids: string[]): Thread =>
  ({ messages: ids.map(message) }) as Thread;

const record = (over: Partial<TripMembershipRecord>): TripMembershipRecord => ({
  key: "<a@x>",
  tripId: "trip-1",
  source: "auto",
  addedAt: NOW,
  ...over,
});

describe("tripMembershipOfThread", () => {
  it("takes the most recent assignment when messages disagree", () => {
    const t = thread("<a@x>", "<b@x>");
    const memberships = {
      "<a@x>": record({ key: "<a@x>", tripId: "trip-1", addedAt: NOW }),
      "<b@x>": record({ key: "<b@x>", tripId: "trip-2", addedAt: NOW + 1000 }),
    };

    expect(tripMembershipOfThread(t, memberships)?.tripId).toBe("trip-2");
  });

  it("lets a later removal beat an earlier add", () => {
    // The tombstone is a membership row like any other; if it isn't allowed to
    // win, removing a thread from a trip would silently do nothing whenever
    // another message in the thread still carried the old assignment.
    const t = thread("<a@x>", "<b@x>");
    const memberships = {
      "<a@x>": record({ key: "<a@x>", tripId: "trip-1", addedAt: NOW }),
      "<b@x>": record({ key: "<b@x>", tripId: null, addedAt: NOW + 1000 }),
    };

    expect(tripIdOfThread(t, memberships)).toBeNull();
  });

  it("returns null for a thread nothing points at", () => {
    expect(tripMembershipOfThread(thread("<a@x>"), {})).toBeNull();
  });
});

describe("suggestTrips", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = Date.UTC(2026, 9, 15);
  const trip = (id: string, startDaysFromNow: number, length = 5) => ({
    id,
    name: id,
    nameIsCustom: false,
    createdAt: 0,
    startDate: NOW + startDaysFromNow * DAY,
    endDate: NOW + (startDaysFromNow + length) * DAY,
  });
  const threadAt = (daysFromNow: number) =>
    ({ id: "t", latestDate: NOW + daysFromNow * DAY, messages: [] }) as unknown as Thread;

  it("puts the current trip first, then trips near the email, then upcoming", () => {
    const trips = [trip("old", -900), trip("next-year", 200), trip("near", -10), trip("current", -400)];
    expect(suggestTrips(trips, threadAt(-8), "current", NOW).map((t) => t.id)).toEqual([
      "current",
      "near",
      "next-year",
    ]);
  });

  it("never lists old trips the email has nothing to do with", () => {
    const trips = Array.from({ length: 50 }, (_, i) => trip(`past${i}`, -100 - i * 20));
    expect(suggestTrips(trips, threadAt(0), null, NOW)).toEqual([]);
  });
});

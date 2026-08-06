import { describe, expect, it } from "vitest";
import { describeTripReason, tripIdOfThread, tripMembershipOfThread } from "./trips";
import type { RawMessage, Thread, TripMembershipRecord } from "./types";

const NOW = Date.UTC(2026, 2, 1);

const message = (headerMessageId: string): RawMessage =>
  ({ id: 1, headerMessageId }) as RawMessage;

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

describe("describeTripReason", () => {
  it("names the confirmation code behind a code match", () => {
    expect(describeTripReason({ kind: "code-match", detail: "ABC123" })).toBe(
      "Shares confirmation ABC123 with this trip",
    );
  });

  it("falls back to a bare phrasing when there is no detail", () => {
    expect(describeTripReason({ kind: "code-match" })).toBe(
      "Shares a confirmation code with this trip",
    );
  });

  it("explains a row written before reasons were recorded", () => {
    // Legacy memberships have no reason until the next recluster backfills
    // one; the chip still has to say something truthful.
    expect(describeTripReason(undefined)).toBe("Added automatically");
  });

  it("distinguishes a manual add from an inferred one", () => {
    expect(describeTripReason({ kind: "manual" })).toBe("You added this to the trip");
    expect(describeTripReason({ kind: "date-range" })).toBe(
      "Its dates fall inside this trip",
    );
  });
});

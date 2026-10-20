import { describe, expect, it } from "vitest";
import { parseHashView, viewForTrips, viewHash } from "./routing";

const at = (hash: string) => {
  window.location.hash = hash;
  return parseHashView();
};

describe("hash routing", () => {
  it("round-trips every view", () => {
    for (const view of [
      { type: "inbox" },
      { type: "snoozed" },
      { type: "draft" },
      { type: "sent" },
      { type: "done" },
      { type: "reminders" },
      { type: "trips" },
      { type: "bundle", category: "promos" },
      { type: "search", query: "dinner \"at 8\" / 50% off" },
    ] as const) {
      expect(at(viewHash(view))).toEqual(view);
    }
  });

  it("swaps trips and the Travel bundle for whichever the setting shows", () => {
    // #bundle/travel is in tab history and bookmarks from before trips, and
    // #trips from before they were turned off. Either would otherwise open an
    // empty page.
    expect(viewForTrips(at("#bundle/travel"), true)).toEqual({ type: "trips" });
    expect(viewForTrips(at("#trips"), false)).toEqual({ type: "bundle", category: "travel" });
    expect(viewForTrips(at("#trips"), true)).toEqual({ type: "trips" });
    expect(viewForTrips(at("#bundle/travel"), false)).toEqual({ type: "bundle", category: "travel" });
  });

  it("encodes custom bundle ids that need escaping", () => {
    const view = { type: "bundle", category: "my bundle/1" } as const;
    expect(at(viewHash(view))).toEqual(view);
  });

  it("falls back to the inbox for anything unrecognised", () => {
    expect(at("#nonsense")).toEqual({ type: "inbox" });
    expect(at("#bundle/")).toEqual({ type: "inbox" });
  });
});

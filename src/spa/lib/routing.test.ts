import { describe, expect, it } from "vitest";
import { parseHashView, viewHash } from "./routing";

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
    ] as const) {
      expect(at(viewHash(view))).toEqual(view);
    }
  });

  it("still honours the old #bundle/travel hash", () => {
    // Trips used to ride on the retired "travel" category, and that hash is
    // sitting in tab history and bookmarks. Without this it would resolve to a
    // bundle view for a category that no longer exists — an empty page.
    expect(at("#bundle/travel")).toEqual({ type: "trips" });
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

import { describe, expect, it } from "vitest";
import { suggestReminders, type SuggestionPart } from "./reminderSuggestions";

const flat = (parts: SuggestionPart[]) => parts.map((p) => p.text).join("");

describe("suggestReminders", () => {
  it("offers Inbox's famous house suggestions, alphabetically", () => {
    const got = suggestReminders("House").map(flat);
    expect(got).toEqual([
      "buy toll house cookies",
      "clean house",
      "house insurance",
      "paint house",
      "sydney opera house",
    ]);
  });

  it("marks the typed words, leaving the rest to be bolded", () => {
    expect(suggestReminders("house")[0]).toEqual([
      { text: "buy toll ", typed: false },
      { text: "house", typed: true },
      { text: " cookies", typed: false },
    ]);
  });

  it("matches a partly typed word by its start", () => {
    const [first] = suggestReminders("call gra");
    expect(first).toEqual([
      { text: "call", typed: true },
      { text: " ", typed: false },
      { text: "gra", typed: true },
      { text: "ndma", typed: false },
    ]);
  });

  it("includes past reminders and drops duplicates and exact matches", () => {
    const got = suggestReminders("water", ["Water the garden", "water plants"]).map(flat);
    expect(got).toEqual(["water plants", "water the garden"]);
    expect(suggestReminders("water plants").map(flat)).toEqual([]);
  });

  it("suggests nothing for an empty query", () => {
    expect(suggestReminders("  ")).toEqual([]);
  });
});

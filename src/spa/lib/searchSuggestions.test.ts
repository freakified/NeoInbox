import { beforeEach, describe, expect, it, vi } from "vitest";
import { recentSearches, rememberSearch, searchSuggestions } from "./searchSuggestions";

const CONTACTS = [
  "Bo Jensen <bo@example.com>",
  "Zoë Park <zoe.park@studio.example>",
  "billing@shop.example",
];

const labels = (text: string, recent: string[] = []) =>
  searchSuggestions(text, CONTACTS, recent).map((s) =>
    s.kind === "recent" ? `recent:${s.query}` : `contact:${s.email}`,
  );

describe("search suggestions", () => {
  beforeEach(() => {
    // Node's own localStorage stub shadows the DOM one here; give each test a fresh store.
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });

  it("offers recent searches on an empty box", () => {
    expect(labels("", ["lisbon", "dinner"])).toEqual(["recent:lisbon", "recent:dinner"]);
  });

  it("matches contacts by the start of any word of their name or address", () => {
    expect(labels("bo")).toEqual(["contact:bo@example.com"]);
    expect(labels("jen")).toEqual(["contact:bo@example.com"]);
    expect(labels("zoe park")).toEqual(["contact:zoe.park@studio.example"]);
    expect(labels("studio")).toEqual(["contact:zoe.park@studio.example"]);
    expect(labels("ark")).toEqual([]);
  });

  it("puts matching recent searches first, never the one already typed", () => {
    expect(labels("bi", ["billing dispute", "bi"])).toEqual([
      "recent:billing dispute",
      "contact:billing@shop.example",
    ]);
  });

  it("remembers searches newest first, without repeats", () => {
    rememberSearch("lisbon");
    rememberSearch("dinner");
    rememberSearch(" lisbon ");
    expect(recentSearches()).toEqual(["lisbon", "dinner"]);
  });
});

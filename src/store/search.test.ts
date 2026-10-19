import { describe, expect, it } from "vitest";
import { highlightRanges, messageMatcher, searchTerms, textMatches } from "./search";
import type { RawMessage } from "../shared/types";

const row = (over: Partial<RawMessage>): RawMessage =>
  ({
    subject: "",
    author: "",
    recipients: [],
    ccList: [],
    ...over,
  }) as RawMessage;

describe("search matching", () => {
  it("splits words, keeps quoted phrases whole, and folds case and accents", () => {
    expect(searchTerms('Café  "Table for TWO" bo')).toEqual(["cafe", "table for two", "bo"]);
    // An unclosed quote runs to the end, as you're still typing it.
    expect(searchTerms('"half typed')).toEqual(["half typed"]);
    expect(searchTerms('  "" ')).toEqual([]);
  });

  it("needs every term, each in any field", () => {
    const m = row({
      subject: "Dinner Friday",
      author: "Bo Jensen <bo@example.com>",
      recipients: ["me@example.com"],
      snippet: "Shall we try the Thai place?",
      attachments: [{ name: "menu.pdf", contentType: "application/pdf", size: 1, partName: "2" }],
    });

    expect(messageMatcher("dinner bo")(m)).toBe(true);
    expect(messageMatcher("thai menu.pdf")(m)).toBe(true);
    expect(messageMatcher('"dinner friday"')(m)).toBe(true);
    expect(messageMatcher('"friday dinner"')(m)).toBe(false);
    expect(messageMatcher("dinner lunch")(m)).toBe(false);
  });

  it("matches at the start of words, anywhere in unspaced scripts", () => {
    const m = row({ subject: "Reservation confirmed", author: "info@hotel.example", snippet: "お荷物お届けのお知らせ" });

    expect(messageMatcher("conf")(m)).toBe(true);
    expect(messageMatcher("hotel")(m)).toBe(true);
    expect(messageMatcher("firmed")(m)).toBe(false);
    expect(messageMatcher("荷物")(m)).toBe(true);
  });

  it("matches nothing for an empty query", () => {
    expect(messageMatcher("   ")(row({ subject: "anything" }))).toBe(false);
    expect(textMatches("", "anything")).toBe(false);
  });
});

describe("highlightRanges", () => {
  const marked = (text: string, query: string) =>
    highlightRanges(text, searchTerms(query)).map(([a, b]) => text.slice(a, b));

  it("marks every occurrence of every term", () => {
    expect(marked("Dinner Friday? Dinner it is", "dinner fri")).toEqual(["Dinner", "Fri", "Dinner"]);
    expect(marked("Photos from the reunion", "r")).toEqual(["r"]);
  });

  it("maps folded matches back onto the original text", () => {
    expect(marked("Café Größe", "cafe")).toEqual(["Café"]);
    // Decomposed accents are two code units in the original, one when folded.
    expect(marked("Cafe\u0301 bar", "cafe bar")).toEqual(["Cafe\u0301", "bar"]);
  });

  it("merges overlapping terms into one range", () => {
    expect(marked("Lisbon", "lis lisbo")).toEqual(["Lisbo"]);
  });
});

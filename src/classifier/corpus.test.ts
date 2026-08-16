/**
 * Runs the built-in classifier rules over the corpus.
 *
 * classifyByRules is pure, so this needs no database, no fake Thunderbird and
 * no bundle configuration — it is the fastest possible check that a rules
 * change hasn't moved mail that was already landing correctly.
 */
import { describe, expect, it } from "vitest";
import { corpus, knownLimitations, tripCandidacy, type CorpusCase } from "./corpus";
import { classifyByRules } from "./pipeline";
import { extractFeatures } from "./features";
import { matchesTravel } from "./rules/travel";

const classify = (entry: CorpusCase): string | null => {
  const header = { author: entry.author, subject: entry.subject } as messenger.messages.MessageHeader;
  return classifyByRules(extractFeatures(header, entry.headers ?? {}));
};

describe("classifier corpus", () => {
  for (const entry of corpus) {
    it(`${entry.name} -> ${entry.expect ?? "no bundle"}`, () => {
      expect(classify(entry)).toBe(entry.expect);
    });
  }

  it("covers every builtin category plus unbundled mail", () => {
    // A rule with no case behind it is a rule nobody is checking.
    const covered = new Set(corpus.map((c) => c.expect));
    for (const category of [
      "forums",
      "purchases",
      "finance",
      "social",
      "promos",
      "updates",
      null,
    ]) {
      expect(covered).toContain(category);
    }
  });
});

describe("trip candidacy", () => {
  // matchesTravel no longer feeds classifyByRules — it only decides whether a
  // message is worth running the reservation extractors over, independently of
  // whatever bundle a route rule sends it to.
  for (const entry of tripCandidacy) {
    it(`${entry.name} -> ${entry.expect ? "candidate" : "not a candidate"}`, () => {
      const header = { author: entry.author, subject: entry.subject };
      expect(matchesTravel(extractFeatures(header, {}))).toBe(entry.expect);
    });
  }

  it("leaves candidates unbundled rather than dropping them into Updates", () => {
    // An unclustered booking must stay visible in the inbox. Without the
    // explicit null return in classifyByRules these fall through to
    // matchesUpdates and vanish into a bundle.
    for (const entry of tripCandidacy.filter((c) => c.expect)) {
      const header = { author: entry.author, subject: entry.subject };
      expect(classifyByRules(extractFeatures(header, {}))).toBeNull();
    }
  });
});

describe("known limitations", () => {
  // These pin current behaviour that is arguably wrong. A failure here is a
  // prompt to check whether the rules got better, not necessarily a bug.
  for (const entry of knownLimitations) {
    it(`${entry.name} (currently ${entry.expect ?? "no bundle"})`, () => {
      expect(classify(entry)).toBe(entry.expect);
    });
  }
});

describe("classification is not thrown by sender formatting", () => {
  const cases: [string, string][] = [
    ["a bare address", "auto-notify@ups.com"],
    ["a quoted display name", '"UPS, Inc." <auto-notify@ups.com>'],
    ["mixed case", "Auto-Notify@UPS.COM"],
    ["extra whitespace", "  UPS  < auto-notify@ups.com >  "],
  ];

  for (const [name, author] of cases) {
    it(`handles ${name}`, () => {
      expect(classify({ name, author, subject: "Package delivered", expect: null }))
        .toBe("purchases");
    });
  }

  it("returns no bundle when the sender is unparseable", () => {
    expect(classify({ name: "empty", author: "", subject: "hello", expect: null })).toBeNull();
  });
});

describe("header lookup", () => {
  it("is case-insensitive, since servers vary in how they cap header names", () => {
    const lower = classify({
      name: "lowercase",
      author: "Dev <dev@lists.example.org>",
      subject: "Re: patch",
      headers: { "list-post": ["<mailto:dev@lists.example.org>"] },
      expect: null,
    });
    const upper = classify({
      name: "uppercase",
      author: "Dev <dev@lists.example.org>",
      subject: "Re: patch",
      headers: { "LIST-POST": ["<mailto:dev@lists.example.org>"] },
      expect: null,
    });

    expect(lower).toBe("forums");
    expect(upper).toBe("forums");
  });

  it("never reads a message with no headers as bulk", () => {
    // What a classification sees when getFull fails: no List-*, no Precedence,
    // no platform fingerprint. Promos requires bulk evidence, so it cannot
    // fire here however promotional the subject reads. The message is still
    // stamped classifiedIncomplete and re-run once the body syncs.
    expect(
      classify({
        name: "no headers",
        author: "Shop <hello@marketing.some-brand.example>",
        subject: "Save 40% — today only",
        expect: null,
      }),
    ).not.toBe("promos");
  });
});

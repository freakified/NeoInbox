import { describe, expect, it } from "vitest";
import { redactAuthor } from "./classifyDebug";
import { corpus, knownLimitations } from "../classifier/corpus";
import { classifyByRules } from "../classifier/pipeline";
import { extractFeatures } from "../classifier/features";

const classify = (author: string, subject: string, headers: Record<string, string[]> = {}) =>
  classifyByRules(
    extractFeatures({ author, subject } as messenger.messages.MessageHeader, headers),
  );

describe("redactAuthor", () => {
  it("keeps the domain, which every domain-list rule depends on", () => {
    expect(redactAuthor("Jamie Fox <jamie.fox@email.chase.com>")).toBe(
      "someone@email.chase.com",
    );
  });

  it("drops the display name, which no rule reads and which names a person", () => {
    expect(redactAuthor("Jamie Fox <jamie.fox@example.com>")).not.toContain("Jamie");
  });

  it("keeps local-part prefixes the rules match on", () => {
    expect(redactAuthor("UPS <auto-notify@ups.com>")).toBe("auto@ups.com");
    expect(redactAuthor("Shop <orders-2847@tiny.example>")).toBe("orders@tiny.example");
    expect(redactAuthor("Acme <no-reply+tag@acme.example>")).toBe("no-reply@acme.example");
  });

  it("handles a bare address with no display name", () => {
    expect(redactAuthor("jamie.fox@example.com")).toBe("someone@example.com");
  });

  it("leaves an unparseable sender alone", () => {
    expect(redactAuthor("")).toBe("");
  });

  it("never changes how a corpus case classifies", () => {
    // The property that makes redaction safe to leave on by default: a
    // captured case must behave identically to the mail it came from.
    for (const entry of [...corpus, ...knownLimitations]) {
      const before = classify(entry.author, entry.subject, entry.headers ?? {});
      const after = classify(redactAuthor(entry.author), entry.subject, entry.headers ?? {});
      expect({ case: entry.name, category: after }).toEqual({
        case: entry.name,
        category: before,
      });
    }
  });
});

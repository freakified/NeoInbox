import { describe, expect, it } from "vitest";
import { redactAuthor, relevantHeaders } from "./classifyDebug";
import { corpus, knownLimitations } from "../classifier/corpus";
import { classifyByRules } from "../classifier/pipeline";
import { extractFeatures } from "../classifier/features";

const classify = (author: string, subject: string, headers: Record<string, string[]> = {}) =>
  classifyByRules(
    extractFeatures({ author, subject } as messenger.messages.MessageHeader, headers),
  );

describe("redactAuthor", () => {
  it("keeps the domain, which every domain-list rule depends on", () => {
    expect(redactAuthor("Jamie Fox <jamie.fox@email.chase.com>")).toContain(
      "@email.chase.com",
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

  it("keeps the shape of a person's address, which is a signal of its own", () => {
    // `first.last` is what keeps a human sender out of a bundle, so the
    // placeholder has to be person-shaped too or the redacted case would
    // classify differently from the mail it came from.
    expect(redactAuthor("jamie.fox@example.com")).toBe("first.last@example.com");
    expect(redactAuthor("Jamie Fox <jamie.fox@chase.com>")).toBe("first.last@chase.com");
  });

  it("keeps role mailbox prefixes, which the rules now read", () => {
    expect(redactAuthor("Acme <support-eu@acme.example>")).toBe("support@acme.example");
    expect(redactAuthor("Billing <billing.dept@utility.example>")).toBe(
      "billing@utility.example",
    );
  });

  it("falls back to a neutral placeholder for an opaque local part", () => {
    expect(redactAuthor("Notion <a7fk2q@mail.notion.so>")).toBe("someone@mail.notion.so");
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

describe("relevantHeaders", () => {
  /** A message carrying one header of every kind a rule now reads. */
  const full = {
    "Message-ID": ["<a@example.com>"],
    Subject: ["Alex replied to your post"],
    "In-Reply-To": ["<parent@example.com>"],
    References: ["<root@example.com> <parent@example.com>"],
    "List-Id": ["<ops.lists.example.org>"],
    "List-Unsubscribe": ["<https://example.com/u>"],
    Precedence: ["bulk"],
    "Auto-Submitted": ["auto-generated"],
    "Feedback-ID": ["acct-9912:campaign-4471:esp"],
    "X-GitHub-Reason": ["subscribed"],
    "X-Mailer": ["Some Client 4.2"],
    Received: ["from mx.example.com by imap.example.com"],
  };

  it("drops everything no rule reads", () => {
    const kept = relevantHeaders(full)!;
    expect(Object.keys(kept)).not.toContain("Received");
    expect(Object.keys(kept)).not.toContain("Message-ID");
  });

  it("keeps the values rules read and redacts the ones they only count", () => {
    const kept = relevantHeaders(full)!;
    // List-Id decides Forums by its host, so its value has to survive.
    expect(kept["List-Id"]).toEqual(["<ops.lists.example.org>"]);
    expect(kept["Precedence"]).toEqual(["bulk"]);
    // These identify the account and the campaign; only presence is a signal.
    expect(kept["References"]).not.toContain("<root@example.com>");
    expect(kept["Feedback-ID"]?.[0]).not.toContain("acct-9912");
    expect(kept["In-Reply-To"]).toBeDefined();
    expect(kept["X-GitHub-Reason"]).toBeDefined();
  });

  it("classifies a dumped case exactly as the message it came from", () => {
    // The promise the dump tool makes: paste the entry into the corpus and it
    // reproduces what the real mail did. Any header a rule starts reading has
    // to be added here too, and this is what fails if it is not.
    const author = "Some Project <team@sending.example>";
    const subject = "Alex replied to your post";
    expect(classify(author, subject, relevantHeaders(full) ?? {})).toBe(
      classify(author, subject, full),
    );
  });

  it("returns undefined when nothing on the message is a signal", () => {
    expect(relevantHeaders({ Received: ["from mx.example.com"] })).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { SNIPPET_CHARS, snippetFromPart } from "./snippet";

type Part = messenger.messages.MessagePart;

const part = (contentType: string, body: string, extra: Partial<Part> = {}): Part =>
  ({ contentType, body, headers: {}, ...extra }) as Part;

const multipart = (...parts: Part[]): Part =>
  ({ contentType: "multipart/alternative", headers: {}, parts }) as Part;

describe("snippetFromPart", () => {
  it("prefers the plain-text body and collapses whitespace", () => {
    const full = multipart(
      part("text/plain", "Hi all —\n\n  rough notes   from today."),
      part("text/html", "<p>ignored</p>"),
    );
    expect(snippetFromPart(full)).toBe("Hi all — rough notes from today.");
  });

  it("flattens an HTML-only body, dropping blockquotes", () => {
    const full = part(
      "text/html",
      "<style>p{}</style><p>Sounds good &amp; see you</p><blockquote>old thread</blockquote>",
    );
    expect(snippetFromPart(full)).toBe("Sounds good & see you");
  });

  it("cuts the quoted history of a reply", () => {
    const body = "Yes, Saturday works.\n\nOn Tue, Oct 14, 2026 Ada wrote:\n> Hike this weekend?";
    expect(snippetFromPart(part("text/plain", body))).toBe("Yes, Saturday works.");
  });

  it("cuts at a signature and skips quoted lines", () => {
    const body = "> earlier\nThanks!\n-- \nSam Sampleton\nVP Ops";
    expect(snippetFromPart(part("text/plain", body))).toBe("Thanks!");
  });

  it("ignores text attachments", () => {
    const full = {
      contentType: "multipart/mixed",
      headers: {},
      parts: [
        part("text/plain", "log line", { name: "log.txt" }),
        part("text/plain", "See the attached log."),
      ],
    } as Part;
    expect(snippetFromPart(full)).toBe("See the attached log.");
  });

  it("caps the length and handles a missing body", () => {
    expect(snippetFromPart(part("text/plain", "x".repeat(500)))).toHaveLength(SNIPPET_CHARS);
    expect(snippetFromPart(null)).toBe("");
  });
});

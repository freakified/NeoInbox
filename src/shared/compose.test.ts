import { describe, expect, it } from "vitest";
import {
  pickIdentity,
  prependToHtmlBody,
  prependToPlainBody,
  replyRecipients,
  splitAddressList,
  textToHtml,
} from "./compose";

const me = new Set(["me@example.com"]);

describe("splitAddressList", () => {
  it("keeps commas inside quoted names", () => {
    expect(splitAddressList('"Last, First" <a@x.com>, b@y.com')).toEqual([
      '"Last, First" <a@x.com>',
      "b@y.com",
    ]);
  });
});

describe("replyRecipients", () => {
  const source = {
    author: "Ann <ann@x.com>",
    recipients: ["Me <me@example.com>", "Bob <bob@x.com>"],
    ccList: ["Cat <cat@x.com>", "bob@x.com"],
  };

  it("replies to the sender only", () => {
    expect(replyRecipients(source, "reply", me)).toEqual({
      to: ["Ann <ann@x.com>"],
      cc: [],
    });
  });

  it("reply-all drops yourself and duplicates", () => {
    expect(replyRecipients(source, "replyAll", me)).toEqual({
      to: ["Ann <ann@x.com>", "Bob <bob@x.com>"],
      cc: ["Cat <cat@x.com>"],
    });
  });

  it("prefers Reply-To over From", () => {
    const listMail = { ...source, replyTo: "List <list@x.com>" };
    expect(replyRecipients(listMail, "reply", me).to).toEqual(["List <list@x.com>"]);
  });

  it("replying to your own message goes to its recipients", () => {
    const sent = { ...source, author: "Me <me@example.com>" };
    expect(replyRecipients(sent, "reply", me).to).toEqual(["Bob <bob@x.com>"]);
  });
});

describe("body helpers", () => {
  it("escapes text and keeps line breaks", () => {
    expect(textToHtml("a < b\nok\n")).toBe("<div>a &lt; b<br>ok</div><br>");
  });

  it("inserts at the top of the HTML body, above the quote", () => {
    const body = '<html><body class="x"><blockquote>old</blockquote></body></html>';
    expect(prependToHtmlBody(body, "<div>hi</div>")).toBe(
      '<html><body class="x"><div>hi</div><blockquote>old</blockquote></body></html>',
    );
  });

  it("prepends to plain text", () => {
    expect(prependToPlainBody("\n\n> old", "hi\n")).toBe("hi\n\n> old");
  });
});

describe("pickIdentity", () => {
  const identities = [
    { id: "a0", accountId: "a", email: "me@example.com", name: "Me" },
    { id: "b0", accountId: "b", email: "me@work.example", name: "Me" },
    { id: "b1", accountId: "b", email: "alias@work.example", name: "Me" },
  ];

  it("replies from the address the mail was sent to", () => {
    expect(
      pickIdentity(identities, { accountId: "b", addresses: ["Ann <ann@x.com>", "ALIAS@work.example"] })?.id,
    ).toBe("b1");
  });

  it("falls back to the account's default, then the overall default", () => {
    expect(pickIdentity(identities, { accountId: "b", addresses: ["ann@x.com"] })?.id).toBe("b0");
    expect(pickIdentity(identities)?.id).toBe("a0");
  });
});

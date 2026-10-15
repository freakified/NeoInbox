import { describe, expect, it } from "vitest";
import { draftBody } from "./draftValue";

describe("draftBody", () => {
  it("takes the user's part of an HTML draft, without Thunderbird's blank lines", () => {
    const html =
      '<html><body><br><div>Hi <b>Ann</b></div><div><br></div><br>' +
      '<div class="moz-cite-prefix">On Mon, Ann wrote:</div><blockquote type="cite">q</blockquote></body></html>';
    expect(draftBody(html, "ignored")).toEqual({
      html: "<div>Hi <b>Ann</b></div>",
      text: "Hi Ann",
    });
  });

  it("is empty for a reply nobody has written yet", () => {
    const html = '<body><br><br><div class="moz-cite-prefix">On Mon:</div><blockquote type="cite">q</blockquote></body>';
    expect(draftBody(html, null)).toEqual({ html: "", text: "" });
  });

  it("falls back to the plain-text part", () => {
    expect(draftBody(null, "Line 1\r\n\r\nLine <2>\r\n\r\nOn Mon, Ann wrote:\r\n> q")).toEqual({
      html: "<div>Line 1</div><div><br></div><div>Line &lt;2&gt;</div>",
      text: "Line 1\n\nLine <2>",
    });
  });
});

import { describe, expect, it } from "vitest";
import { htmlToPlainText, isRichTextBlank, sanitizeComposerHtml } from "./richText";

describe("sanitizeComposerHtml", () => {
  it("keeps basic formatting and drops everything else", () => {
    expect(
      sanitizeComposerHtml(
        '<b style="color:red">bold</b> <span class="x"><i>it</i></span><script>alert(1)</script><img src=x onerror=alert(1)>',
      ),
    ).toBe("<b>bold</b> <i>it</i>");
  });

  it("keeps only safe links", () => {
    expect(sanitizeComposerHtml('<a href="https://a.com" onclick="x()">a</a>')).toBe(
      '<a href="https://a.com">a</a>',
    );
    expect(sanitizeComposerHtml('<a href="javascript:alert(1)">a</a>')).toBe("a");
  });
});

describe("htmlToPlainText", () => {
  it("turns the editor's line divs into lines", () => {
    expect(htmlToPlainText("one<div>two</div><div><br></div><div>four</div>")).toBe(
      "one\ntwo\n\nfour",
    );
  });

  it("bullets and numbers lists", () => {
    expect(htmlToPlainText("Hi<ul><li>a</li><li>b</li></ul><ol><li>x</li><li>y</li></ol>")).toBe(
      "Hi\n• a\n• b\n1. x\n2. y",
    );
  });

  it("spells out links whose text isn't the address", () => {
    expect(htmlToPlainText('see <a href="https://a.com">this</a>')).toBe("see this <https://a.com>");
    expect(htmlToPlainText('<a href="https://a.com">https://a.com</a>')).toBe("https://a.com");
  });
});

describe("isRichTextBlank", () => {
  it("treats leftover breaks as blank but an empty list as content", () => {
    expect(isRichTextBlank("<div><br></div>")).toBe(true);
    expect(isRichTextBlank("<ul><li><br></li></ul>")).toBe(false);
  });
});

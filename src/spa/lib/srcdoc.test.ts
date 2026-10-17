import { describe, expect, it } from "vitest";
import { buildSrcdoc, buildTextSrcdoc, hasBlockedRemoteImages } from "./srcdoc";

const parse = (srcdoc: string): Document =>
  new DOMParser().parseFromString(srcdoc, "text/html");

const cspOf = (srcdoc: string): string =>
  parse(srcdoc)
    .querySelector('meta[http-equiv="Content-Security-Policy"]')
    ?.getAttribute("content") ?? "";

describe("buildSrcdoc content security policy", () => {
  it("denies everything by default and never allows scripts", () => {
    const csp = cspOf(buildSrcdoc("<p>hi</p>", false));
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("form-action 'none'");
  });

  it("keeps remote hosts out of img-src while images are blocked", () => {
    const csp = cspOf(buildSrcdoc('<img src="https://tracker.example/x.gif">', false));
    expect(csp).toMatch(/img-src data: cid: blob:;/);
    expect(csp).not.toContain("img-src data: cid: blob: https:");
  });

  it("widens only img-src and media-src once the user allows images", () => {
    const csp = cspOf(buildSrcdoc('<img src="https://cdn.example/x.png">', true));
    expect(csp).toContain("img-src data: cid: blob: https: http:");
    expect(csp).toContain("media-src data: cid: blob: https: http:");
    // Fonts and stylesheets stay local even when images are allowed.
    expect(csp).toContain("font-src data:");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain("script-src 'none'");
  });

  it("applies the same policy to plain-text bodies", () => {
    expect(cspOf(buildTextSrcdoc("plain body"))).toContain("default-src 'none'");
  });
});

describe("buildSrcdoc active content stripping", () => {
  const cases: [string, string, string][] = [
    ["scripts", "<script>alert(1)</script><p>body</p>", "script"],
    ["nested frames", '<iframe src="https://tracker.example/"></iframe>', "iframe"],
    ["objects", '<object data="https://tracker.example/x"></object>', "object"],
    ["embeds", '<embed src="https://tracker.example/x">', "embed"],
    ["remote stylesheets", '<link rel="stylesheet" href="https://tracker.example/x.css">', "link"],
    ["base tags", '<base href="https://tracker.example/">', "base"],
  ];

  for (const [name, html, selector] of cases) {
    it(`removes ${name}`, () => {
      const doc = parse(buildSrcdoc(html, false));
      expect(doc.querySelectorAll(selector)).toHaveLength(0);
    });
  }

  it("removes meta refresh redirects but keeps charset declarations", () => {
    const doc = parse(
      buildSrcdoc(
        '<meta charset="utf-8"><meta http-equiv="refresh" content="0;url=https://tracker.example/">',
        false,
      ),
    );
    expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull();
    expect(doc.querySelector("meta[charset]")).not.toBeNull();
  });

  it("strips active content even when the user has allowed images", () => {
    const doc = parse(buildSrcdoc('<iframe src="https://tracker.example/"></iframe>', true));
    expect(doc.querySelectorAll("iframe")).toHaveLength(0);
  });
});

describe("remote image blocking", () => {
  it("strips img src and srcset, stashing them for a later reveal", () => {
    const doc = parse(
      buildSrcdoc('<img src="https://tracker.example/p.gif" srcset="https://tracker.example/2x.gif 2x">', false),
    );
    const img = doc.querySelector("img")!;
    expect(img.hasAttribute("src")).toBe(false);
    expect(img.hasAttribute("srcset")).toBe(false);
    expect(img.dataset.src).toBe("https://tracker.example/p.gif");
  });

  it("leaves data: and cid: images alone", () => {
    const doc = parse(
      buildSrcdoc('<img src="data:image/gif;base64,R0lGOD"><img src="cid:logo@example">', false),
    );
    const [inline, embedded] = Array.from(doc.querySelectorAll("img"));
    expect(inline!.getAttribute("src")).toBe("data:image/gif;base64,R0lGOD");
    expect(embedded!.getAttribute("src")).toBe("cid:logo@example");
  });

  it("blocks remote video posters and image inputs", () => {
    const doc = parse(
      buildSrcdoc(
        '<video poster="https://tracker.example/p.jpg"></video>' +
          '<input type="image" src="https://tracker.example/b.gif">',
        false,
      ),
    );
    expect(doc.querySelector("video")!.hasAttribute("poster")).toBe(false);
    expect(doc.querySelector("input")!.hasAttribute("src")).toBe(false);
  });

  it("blocks remote CSS background images", () => {
    const doc = parse(
      buildSrcdoc('<div style="background-image:url(https://tracker.example/bg.png)">x</div>', false),
    );
    expect(doc.querySelector("div")!.style.backgroundImage).not.toContain("tracker.example");
  });

  it("restores everything when the user allows images", () => {
    const doc = parse(buildSrcdoc('<img src="https://cdn.example/x.png">', true));
    expect(doc.querySelector("img")!.getAttribute("src")).toBe("https://cdn.example/x.png");
  });
});

describe("hasBlockedRemoteImages", () => {
  it.each([
    ['<img src="https://tracker.example/p.gif">', true],
    ['<source srcset="https://tracker.example/p.gif">', true],
    ['<video poster="https://tracker.example/p.jpg"></video>', true],
    ['<input type="image" src="https://tracker.example/b.gif">', true],
    ['<div style="background-image:url(https://tracker.example/bg.png)">x</div>', true],
    ['<img src="data:image/gif;base64,R0lGOD">', false],
    ['<img src="cid:logo@example">', false],
    ["<p>no images at all</p>", false],
  ])("reports %s as %s", (html, expected) => {
    expect(hasBlockedRemoteImages(html)).toBe(expected);
  });
});

describe("trailing blank lines", () => {
  const bodyOf = (srcdoc: string): string =>
    new DOMParser().parseFromString(srcdoc, "text/html").body.innerHTML;

  it("drops the empty lines mail clients leave at the end, even when nested", () => {
    const html =
      '<div dir="ltr"><div>Hi</div><div><a href="https://x.test">x</a></div>' +
      "<div><br></div><div><br></div>\n</div><br>\n";
    expect(bodyOf(buildSrcdoc(html, false))).toBe(
      '<div dir="ltr"><div>Hi</div><div><a href="https://x.test">x</a></div></div>',
    );
  });

  it("keeps a trailing image, table, or rule", () => {
    for (const tail of ['<div><img src="cid:a"></div>', "<table><tr><td></td></tr></table>", "<hr>"]) {
      expect(bodyOf(buildSrcdoc(`<p>Hi</p>${tail}<br>`, false))).toContain(tail.slice(0, 4));
    }
  });
});

describe("quoted reply trimming", () => {
  // What an inline reply sends: the user's part, then Thunderbird's reply body.
  const reply =
    "<html><body><div><div>Thanks!</div><div>--Dan</div><div><br></div></div><br>" +
    '<p><br></p><div class="moz-cite-prefix">On Mon, Ann wrote:<br></div>' +
    '<blockquote type="cite">original</blockquote></body></html>';

  it("folds the blank lines above the quote away with it", () => {
    const body = parse(buildSrcdoc(reply, false)).body;
    const visible = Array.from(body.children).filter(
      (el) => !el.classList.contains("nb-quoted") && !el.matches("input, label"),
    );
    expect(visible.map((el) => el.outerHTML)).toEqual([
      "<div><div>Thanks!</div><div>--Dan</div></div>",
    ]);
    expect(body.querySelector("label.nb-toggle-label")?.previousElementSibling?.tagName).toBe(
      "INPUT",
    );
    expect(body.querySelector("blockquote")?.classList.contains("nb-quoted")).toBe(true);
  });
});

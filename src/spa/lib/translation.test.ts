import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertTranslationConfigured,
  DEFAULT_TRANSLATION_CONFIG,
  setTranslationConfig,
  translationEnabled,
  TARGET_LANGUAGES,
  translateHtml,
  translatePlainText,
  translationOrigin,
  TranslationSetupError,
  uiTargetLanguage,
  type TranslationConfig,
} from "./translation";

const english = TARGET_LANGUAGES.find((lang) => lang.code === "en")!;
const config = (patch: Partial<TranslationConfig>): TranslationConfig => ({
  ...DEFAULT_TRANSLATION_CONFIG,
  ...patch,
});

/** Fakes fetch with a responder; returns the parsed JSON bodies it was sent. */
const stubFetch = (respond: (body: any, url: string) => unknown) => {
  const bodies: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      return new Response(JSON.stringify(respond(body, url)), { status: 200 });
    }),
  );
  return bodies;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("translateHtml", () => {
  it("sends inline runs as single HTML segments in one DeepL batch", async () => {
    const bodies = stubFetch((body) => ({
      translations: body.text.map((text: string) => ({ text: `[${text}]` })),
    }));
    const html =
      "<html><body><p>Hallo <b>Welt</b>, wie geht's?</p>" +
      "<table><tr><td>Zelle</td><td><code>x = 1</code></td></tr></table>" +
      "<!-- kommentar --><div>Ende<div>innen</div></div></body></html>";

    const out = await translateHtml(html, config({ provider: "deepl", apiKey: "k:fx" }), english);

    expect(bodies).toHaveLength(1);
    expect(bodies[0].tag_handling).toBe("html");
    expect(bodies[0].target_lang).toBe("EN-US");
    expect(bodies[0].text).toEqual(["Hallo <b>Welt</b>, wie geht's?", "Zelle", "Ende", "innen"]);
    expect(out).toContain("<p>[Hallo <b>Welt</b>, wie geht's?]</p>");
    expect(out).toContain("<code>x = 1</code>");
    expect(out).toContain("<!-- kommentar -->");
    expect(out).toContain("<div>[Ende]<div>[innen]</div></div>");
  });

  it("splits batches at the provider's size limit", async () => {
    const bodies = stubFetch((body) => ({
      data: { translations: body.q.map((text: string) => ({ translatedText: text })) },
    }));
    const paragraph = `<p>${"wort ".repeat(400)}</p>`;
    await translateHtml(
      `<body>${paragraph.repeat(6)}</body>`,
      config({ provider: "google", apiKey: "key" }),
      english,
    );
    expect(bodies.length).toBeGreaterThan(1);
    expect(bodies.flatMap((body) => body.q)).toHaveLength(6);
  });

  it("falls back to one request per text when a model can't return a JSON array", async () => {
    const bodies = stubFetch((body) => {
      const content = body.messages[1].content as string;
      return {
        choices: [{ message: { content: content.startsWith("[") ? "Sure! Here you go." : `EN ${content}` } }],
      };
    });
    const out = await translateHtml(
      "<body><p>eins</p><p>zwei</p></body>",
      config({ provider: "openaiCompatible", endpoint: "http://localhost:11434/v1/chat/completions", model: "m" }),
      english,
    );
    expect(bodies).toHaveLength(3);
    expect(out).toContain("<p>EN eins</p><p>EN zwei</p>");
  });

  it("asks for a model instead of guessing one", async () => {
    stubFetch(() => ({}));
    await expect(
      translateHtml(
        "<body><p>eins</p></body>",
        config({ provider: "openaiCompatible", endpoint: "http://localhost:1234/v1/chat/completions" }),
        english,
      ),
    ).rejects.toThrow(/model/);
  });
});

describe("translatePlainText", () => {
  it("translates paragraphs and keeps the breaks between them", async () => {
    stubFetch((body) => ({ translatedText: body.q.map((text: string) => text.toUpperCase()) }));
    const out = await translatePlainText(
      "erste zeile\nzweite\n\n\ndritte",
      config({ provider: "libretranslate", endpoint: "https://lt.example.org/translate" }),
      english,
    );
    expect(out).toBe("ERSTE ZEILE\nZWEITE\n\n\nDRITTE");
  });
});

describe("translationOrigin", () => {
  it("picks the DeepL host from the key", () => {
    expect(translationOrigin(config({ provider: "deepl", apiKey: "abc:fx" }))).toBe(
      "https://api-free.deepl.com/*",
    );
    expect(translationOrigin(config({ provider: "deepl", apiKey: "abc" }))).toBe(
      "https://api.deepl.com/*",
    );
  });

  it("has no default host for an OpenAI-compatible endpoint", () => {
    expect(translationOrigin(config({ provider: "openaiCompatible" }))).toBeNull();
  });
});

describe("assertTranslationConfigured", () => {
  const stubStorage = () => {
    // Node's own localStorage stub shadows the DOM one here; give each test a fresh store.
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  };

  it("asks for setup when translation was never configured", () => {
    stubStorage();
    expect(() => assertTranslationConfigured(DEFAULT_TRANSLATION_CONFIG)).toThrow(
      TranslationSetupError,
    );
  });

  it("names the missing setting for the chosen provider", () => {
    stubStorage();
    const local = config({ provider: "openaiCompatible", endpoint: "http://localhost:1234/v1" });
    setTranslationConfig(local);
    expect(() => assertTranslationConfigured(local)).toThrow("Add a Local LLM model in Settings.");
  });

  it("passes once the provider's required settings are filled in", () => {
    stubStorage();
    const deepl = config({ provider: "deepl", apiKey: "abc:fx" });
    setTranslationConfig(deepl);
    expect(() => assertTranslationConfigured(deepl)).not.toThrow();
  });

  it("ships with translation off until it's turned on", () => {
    stubStorage();
    expect(translationEnabled()).toBe(false);
    setTranslationConfig(config({ enabled: true }));
    expect(translationEnabled()).toBe(true);
  });
});

describe("uiTargetLanguage", () => {
  const withLanguage = (language: string) => {
    vi.stubGlobal("navigator", { language });
    return uiTargetLanguage().code;
  };

  it("maps the UI language onto the offered targets", () => {
    expect(withLanguage("de-DE")).toBe("de");
    expect(withLanguage("pt-PT")).toBe("pt-PT");
    expect(withLanguage("pt")).toBe("pt-BR");
    expect(withLanguage("zh-TW")).toBe("zh-Hant");
    expect(withLanguage("zh-CN")).toBe("zh-Hans");
    expect(withLanguage("nn-NO")).toBe("nb");
    expect(withLanguage("xx")).toBe("en");
  });
});

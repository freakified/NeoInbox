import { liveTbId } from "../../shared/liveMessage";
import { db } from "../../store/db";
import type { RawMessage, TranslationRecord } from "../../shared/types";
import { extractHtmlBody, extractRawTextBody } from "./srcdoc";

const TRANSLATION_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const TRANSLATION_CONFIG_KEY = "neoinbox.translationConfig";
const DEEPL_FREE_ENDPOINT = "https://api-free.deepl.com/v2/translate";
const DEEPL_PRO_ENDPOINT = "https://api.deepl.com/v2/translate";
const GOOGLE_ENDPOINT = "https://translation.googleapis.com/language/translate/v2";
const AZURE_ENDPOINT = "https://api.cognitive.microsofttranslator.com";
/** Requests in flight at once; more trips free-tier rate limits. */
const BATCH_CONCURRENCY = 2;
const MAX_ATTEMPTS = 3;

export type TranslationProvider =
  | "deepl"
  | "google"
  | "azure"
  | "libretranslate"
  | "openaiCompatible"
  | "custom";

export interface TranslationConfig {
  /** Off by default: the Translate menu item only shows once it's turned on. */
  enabled: boolean;
  provider: TranslationProvider;
  apiKey: string;
  endpoint: string;
  region: string;
  model: string;
  /** A TARGET_LANGUAGES code, or "" to follow Thunderbird's language. */
  targetLanguage: string;
}

export const DEFAULT_TRANSLATION_CONFIG: TranslationConfig = {
  enabled: false,
  provider: "deepl",
  apiKey: "",
  endpoint: "",
  region: "",
  model: "",
  targetLanguage: "",
};

export const TRANSLATION_PROVIDERS: Record<
  TranslationProvider,
  {
    label: string;
    apiKey: "required" | "optional" | "none";
    /** "override" replaces a built-in default; "required" has none. */
    endpoint: "required" | "override" | "none";
    endpointPlaceholder?: string;
    /** Filled in when the provider is picked, where the usual endpoint is a safe guess. */
    defaultEndpoint?: string;
    region?: boolean;
    model?: boolean;
    helpText?: string;
  }
> = {
  deepl: {
    label: "DeepL",
    apiKey: "required",
    endpoint: "override",
    endpointPlaceholder: "Picked from your key (Free or Pro)",
  },
  google: { label: "Google Cloud Translation", apiKey: "required", endpoint: "none" },
  azure: {
    label: "Azure Translator",
    apiKey: "required",
    endpoint: "override",
    endpointPlaceholder: AZURE_ENDPOINT,
    region: true,
  },
  libretranslate: {
    label: "LibreTranslate",
    apiKey: "optional",
    endpoint: "required",
    endpointPlaceholder: "https://libretranslate.com/translate",
    defaultEndpoint: "https://libretranslate.com/translate",
    helpText: "Any LibreTranslate-compatible endpoint.",
  },
  openaiCompatible: {
    label: "Local LLM",
    apiKey: "optional",
    endpoint: "required",
    endpointPlaceholder: "http://localhost:1234/v1/chat/completions",
    defaultEndpoint: "http://localhost:1234/v1/chat/completions",
    model: true,
    helpText:
      "Works with LM Studio (http://localhost:1234/v1/chat/completions), " +
      "Ollama (http://localhost:11434/v1/chat/completions), or any hosted OpenAI-compatible API.",
  },
  custom: {
    label: "Custom endpoint",
    apiKey: "none",
    endpoint: "required",
    endpointPlaceholder: "https://example.com/translate",
    helpText: "Takes JSON { text, targetLanguage } and returns { translatedText }.",
  },
};

interface TargetLanguage {
  code: string;
  label: string;
  /** Provider codes where they differ from `code`; DeepL defaults to it uppercased. */
  deepl?: string;
  google?: string;
  azure?: string;
  libre?: string;
}

/** Languages every built-in provider can translate into. */
export const TARGET_LANGUAGES: TargetLanguage[] = [
  { code: "ar", label: "Arabic" },
  { code: "bg", label: "Bulgarian" },
  { code: "zh-Hans", label: "Chinese (Simplified)", google: "zh-CN", libre: "zh" },
  { code: "zh-Hant", label: "Chinese (Traditional)", google: "zh-TW", libre: "zt" },
  { code: "cs", label: "Czech" },
  { code: "da", label: "Danish" },
  { code: "nl", label: "Dutch" },
  { code: "en", label: "English", deepl: "EN-US" },
  { code: "et", label: "Estonian" },
  { code: "fi", label: "Finnish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "el", label: "Greek" },
  { code: "hu", label: "Hungarian" },
  { code: "id", label: "Indonesian" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "lv", label: "Latvian" },
  { code: "lt", label: "Lithuanian" },
  { code: "nb", label: "Norwegian", google: "no" },
  { code: "pl", label: "Polish" },
  { code: "pt-BR", label: "Portuguese (Brazil)", google: "pt", azure: "pt", libre: "pt" },
  { code: "pt-PT", label: "Portuguese (Portugal)", azure: "pt-pt", libre: "pt" },
  { code: "ro", label: "Romanian" },
  { code: "ru", label: "Russian" },
  { code: "sk", label: "Slovak" },
  { code: "sl", label: "Slovenian" },
  { code: "es", label: "Spanish" },
  { code: "sv", label: "Swedish" },
  { code: "tr", label: "Turkish" },
  { code: "uk", label: "Ukrainian" },
];

const findLanguage = (code: string): TargetLanguage | undefined =>
  TARGET_LANGUAGES.find((lang) => lang.code.toLowerCase() === code.toLowerCase());

/** Thunderbird's UI language as a target, English when it isn't one we offer. */
export const uiTargetLanguage = (): TargetLanguage => {
  const ui =
    (typeof messenger !== "undefined" ? messenger.i18n?.getUILanguage?.() : undefined) ??
    navigator.language ??
    "en";
  const [base = "en", ...rest] = ui.replace(/_/g, "-").toLowerCase().split("-");
  const regionOrScript = rest.join("-");
  if (base === "zh") {
    return findLanguage(/hant|tw|hk|mo/.test(regionOrScript) ? "zh-Hant" : "zh-Hans")!;
  }
  if (base === "pt") return findLanguage(regionOrScript === "pt" ? "pt-PT" : "pt-BR")!;
  if (base === "no" || base === "nn") return findLanguage("nb")!;
  return findLanguage(base) ?? findLanguage("en")!;
};

const resolveTargetLanguage = (config: TranslationConfig): TargetLanguage =>
  (config.targetLanguage && findLanguage(config.targetLanguage)) || uiTargetLanguage();

/** The language a translate click produces with the saved settings. */
export const translationTargetLabel = (): string =>
  resolveTargetLanguage(getTranslationConfig()).label;

export const targetLanguageLabel = (code: string): string =>
  findLanguage(code)?.label ?? code;

const normalizeText = (text: string): string =>
  text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();

const normalizeHtml = (html: string): string => html.replace(/\r\n/g, "\n").trim();

const hashText = (text: string): string => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`;
};

/** Endpoint and model are in the id so switching either retranslates. */
const translationId = (
  messageKey: string,
  bodyHash: string,
  config: TranslationConfig,
  target: TargetLanguage,
): string =>
  `${messageKey}:${config.provider}:${target.code}:` +
  `${hashText(`${config.endpoint}\n${config.model}`)}:${bodyHash}`;

const isFreshTranslation = (record: TranslationRecord): boolean =>
  Date.now() - record.createdAt < TRANSLATION_CACHE_TTL_MS;

const pruneExpiredTranslations = async (): Promise<void> => {
  await db.translations
    .where("createdAt")
    .below(Date.now() - TRANSLATION_CACHE_TTL_MS)
    .delete();
};

const parseProvider = (value: unknown): TranslationProvider =>
  typeof value === "string" && value in TRANSLATION_PROVIDERS
    ? (value as TranslationProvider)
    : DEFAULT_TRANSLATION_CONFIG.provider;

const normalizeConfig = (config: TranslationConfig): TranslationConfig => ({
  enabled: config.enabled,
  provider: config.provider,
  apiKey: config.apiKey.trim(),
  endpoint: config.endpoint.trim(),
  region: config.region.trim(),
  model: config.model.trim(),
  targetLanguage: findLanguage(config.targetLanguage)?.code ?? "",
});

export const getTranslationConfig = (): TranslationConfig => {
  const raw = localStorage.getItem(TRANSLATION_CONFIG_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<TranslationConfig>;
      const str = (value: unknown): string => (typeof value === "string" ? value : "");
      return normalizeConfig({
        enabled: parsed.enabled === true,
        provider: parseProvider(parsed.provider),
        apiKey: str(parsed.apiKey),
        endpoint: str(parsed.endpoint),
        region: str(parsed.region),
        model: str(parsed.model),
        targetLanguage: str(parsed.targetLanguage),
      });
    } catch {
      // Unreadable config: fall back to the defaults.
    }
  }

  return DEFAULT_TRANSLATION_CONFIG;
};

export const translationEnabled = (): boolean => getTranslationConfig().enabled;

export const setTranslationConfig = (config: TranslationConfig): void => {
  localStorage.setItem(TRANSLATION_CONFIG_KEY, JSON.stringify(normalizeConfig(config)));
};

const decodeHtmlEntities = (text: string): string => {
  const doc = new DOMParser().parseFromString(text, "text/html");
  return doc.documentElement.textContent ?? text;
};

/** One translated string per input, in order, or an error naming the provider. */
const expectTexts = (values: unknown, count: number, provider: string): string[] => {
  if (
    !Array.isArray(values) ||
    values.length !== count ||
    values.some((value) => typeof value !== "string")
  ) {
    throw new Error(`${provider} response did not include translated text.`);
  }
  return (values as string[]).map((value) => value.trim());
};

/** Translation can't run until the user fills in Settings; the UI links there. */
export class TranslationSetupError extends Error {}

const requireApiKey = (config: TranslationConfig): string => {
  if (!config.apiKey) {
    throw new TranslationSetupError(
      `Add a ${TRANSLATION_PROVIDERS[config.provider].label} API key in Settings.`,
    );
  }
  return config.apiKey;
};

const requireEndpoint = (config: TranslationConfig): string => {
  if (!config.endpoint) {
    throw new TranslationSetupError(
      `Add a ${TRANSLATION_PROVIDERS[config.provider].label} endpoint in Settings.`,
    );
  }
  return config.endpoint;
};

const requireModel = (config: TranslationConfig): string => {
  if (!config.model) {
    throw new TranslationSetupError(
      `Add a ${TRANSLATION_PROVIDERS[config.provider].label} model in Settings.`,
    );
  }
  return config.model;
};

/**
 * Checks the settings a provider can't run without, before any permission
 * prompt or request. Never-saved settings get a general "set it up" message.
 */
export const assertTranslationConfigured = (config: TranslationConfig): void => {
  if (localStorage.getItem(TRANSLATION_CONFIG_KEY) === null) {
    throw new TranslationSetupError("Translation isn't set up yet. Choose a service in Settings.");
  }
  const meta = TRANSLATION_PROVIDERS[config.provider];
  if (meta.apiKey === "required") requireApiKey(config);
  if (meta.endpoint === "required") requireEndpoint(config);
  if (meta.model) requireModel(config);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retries rate limits and brief outages, honouring Retry-After when given. */
const fetchJson = async (url: string, init: RequestInit): Promise<unknown> => {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res.json();
    if ((res.status !== 429 && res.status !== 503) || attempt >= MAX_ATTEMPTS) {
      throw new Error(`Translation failed with HTTP ${res.status}`);
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 1000 * 2 ** (attempt - 1));
  }
};

/** DeepL Free keys end in ":fx" and only work against the free host. */
const deeplEndpoint = (config: TranslationConfig): string =>
  config.endpoint || (config.apiKey.endsWith(":fx") ? DEEPL_FREE_ENDPOINT : DEEPL_PRO_ENDPOINT);

type TextFormat = "text" | "html";

type BatchRequest = (
  texts: string[],
  format: TextFormat,
  config: TranslationConfig,
  target: TargetLanguage,
) => Promise<string[]>;

const requestDeepL: BatchRequest = async (texts, format, config, target) => {
  const payload = (await fetchJson(deeplEndpoint(config), {
    method: "POST",
    headers: {
      authorization: `DeepL-Auth-Key ${requireApiKey(config)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text: texts,
      target_lang: target.deepl ?? target.code.toUpperCase(),
      ...(format === "html" ? { tag_handling: "html" } : {}),
    }),
  })) as { translations?: Array<{ text?: unknown }> };
  return expectTexts(payload.translations?.map((t) => t.text), texts.length, "DeepL");
};

const requestGoogle: BatchRequest = async (texts, format, config, target) => {
  const payload = (await fetchJson(GOOGLE_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": requireApiKey(config),
    },
    body: JSON.stringify({ q: texts, target: target.google ?? target.code, format }),
  })) as { data?: { translations?: Array<{ translatedText?: unknown }> } };
  const translated = expectTexts(
    payload.data?.translations?.map((t) => t.translatedText),
    texts.length,
    "Google",
  );
  // Google escapes entities even in text mode; HTML mode keeps them as markup.
  return format === "text" ? translated.map(decodeHtmlEntities) : translated;
};

const requestAzure: BatchRequest = async (texts, format, config, target) => {
  const endpoint = (config.endpoint || AZURE_ENDPOINT).replace(/\/$/, "");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "ocp-apim-subscription-key": requireApiKey(config),
  };
  if (config.region) headers["ocp-apim-subscription-region"] = config.region;
  const params = new URLSearchParams({
    "api-version": "3.0",
    to: target.azure ?? target.code,
    textType: format === "html" ? "html" : "plain",
  });
  const payload = (await fetchJson(`${endpoint}/translate?${params}`, {
    method: "POST",
    headers,
    body: JSON.stringify(texts.map((text) => ({ text }))),
  })) as Array<{ translations?: Array<{ text?: unknown }> }>;
  return expectTexts(
    Array.isArray(payload) ? payload.map((item) => item.translations?.[0]?.text) : undefined,
    texts.length,
    "Azure",
  );
};

const requestLibreTranslate: BatchRequest = async (texts, format, config, target) => {
  const payload = (await fetchJson(requireEndpoint(config), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      q: texts,
      source: "auto",
      target: target.libre ?? target.code,
      format,
      api_key: config.apiKey || undefined,
    }),
  })) as { translatedText?: unknown };
  return expectTexts(payload.translatedText, texts.length, "LibreTranslate");
};

const parseChatContent = (payload: unknown): string => {
  const choice = (payload as {
    choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
  })?.choices?.[0];
  const value = choice?.message?.content ?? choice?.text;
  // Reasoning models may lead with their thinking; only the answer counts.
  return typeof value === "string" ? value.replace(/<think>[\s\S]*?<\/think>/g, "").trim() : "";
};

const parseJsonStringArray = (content: string, count: number): string[] | null => {
  try {
    const parsed: unknown = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    return Array.isArray(parsed) &&
      parsed.length === count &&
      parsed.every((value) => typeof value === "string")
      ? (parsed as string[]).map((value) => value.trim())
      : null;
  } catch {
    return null;
  }
};

/**
 * Batches go as a JSON array to keep request counts down; a model that
 * can't answer in kind falls back to one request per text.
 */
const requestOpenAICompatible: BatchRequest = async (texts, format, config, target) => {
  const endpoint = requireEndpoint(config);
  const model = requireModel(config);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

  const chat = async (instructions: string[], content: string): Promise<string> =>
    parseChatContent(await fetchJson(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: [
              `Translate the user's email text to ${target.label}.`,
              ...instructions,
              "Preserve paragraph breaks, links, dates, names, and quoted text.",
              ...(format === "html"
                ? ["The text contains HTML: keep every tag and attribute exactly as given and translate only the text between tags."]
                : []),
            ].join(" "),
          },
          { role: "user", content },
        ],
      }),
    }));

  const translateOne = async (text: string): Promise<string> => {
    const translated = await chat(["Return only the translated text."], text);
    if (!translated) throw new Error("Local LLM response did not include translated text.");
    return translated;
  };

  if (texts.length === 1) return [await translateOne(texts[0]!)];
  const batched = parseJsonStringArray(
    await chat(
      [
        "The user sends a JSON array of strings.",
        "Reply with only a JSON array of the translated strings, same length and order.",
      ],
      JSON.stringify(texts),
    ),
    texts.length,
  );
  if (batched) return batched;
  const translated: string[] = [];
  for (const text of texts) translated.push(await translateOne(text));
  return translated;
};

const requestCustom: BatchRequest = async (texts, _format, config, target) => {
  const endpoint = requireEndpoint(config);
  const translated: string[] = [];
  for (const text of texts) {
    const record = (await fetchJson(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        targetLanguage: target.code,
        targetLabel: target.label,
      }),
    })) as Record<string, unknown> | null;
    const value = record?.translatedText ?? record?.translation ?? record?.text;
    translated.push(...expectTexts([value], 1, "Translation"));
  }
  return translated;
};

/**
 * How each provider takes text. `html` providers get whole runs of inline
 * markup (so a sentence split by <b> or <a> keeps its context); the rest get
 * bare text nodes. Limits keep each request under the provider's caps.
 */
const ENGINES: Record<
  TranslationProvider,
  { request: BatchRequest; html: boolean; maxItems: number; maxChars: number }
> = {
  // 50 texts and 128 KiB per request.
  deepl: { request: requestDeepL, html: true, maxItems: 50, maxChars: 30_000 },
  // 128 segments; Google recommends at most 5,000 characters.
  google: { request: requestGoogle, html: true, maxItems: 128, maxChars: 5_000 },
  // 1,000 elements and 50,000 characters, markup included.
  azure: { request: requestAzure, html: true, maxItems: 1_000, maxChars: 40_000 },
  libretranslate: { request: requestLibreTranslate, html: true, maxItems: 50, maxChars: 5_000 },
  openaiCompatible: { request: requestOpenAICompatible, html: true, maxItems: 20, maxChars: 4_000 },
  custom: { request: requestCustom, html: false, maxItems: 1, maxChars: Infinity },
};

const chunkTexts = (texts: string[], maxItems: number, maxChars: number): string[][] => {
  const batches: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const text of texts) {
    if (current.length && (current.length >= maxItems || chars + text.length > maxChars)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(text);
    chars += text.length;
  }
  if (current.length) batches.push(current);
  return batches;
};

/** Translates every text, a few batches at a time, keeping input order. */
const translateTexts = async (
  texts: string[],
  format: TextFormat,
  config: TranslationConfig,
  target: TargetLanguage,
): Promise<string[]> => {
  if (!texts.length) return [];
  const engine = ENGINES[config.provider];
  const batches = chunkTexts(texts, engine.maxItems, engine.maxChars);
  const results: string[][] = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const index = next++;
      results[index] = await engine.request(batches[index]!, format, config, target);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(BATCH_CONCURRENCY, batches.length) }, worker),
  );
  return results.flat();
};

const NO_TRANSLATE_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "SELECT",
  "OPTION",
  "CODE",
  "SAMP",
  "KBD",
]);

const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "CENTER", "DD", "DETAILS", "DIALOG",
  "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1",
  "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P",
  "PRE", "SECTION", "SUMMARY", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD",
  "TR", "UL",
]);

const TRANSLATABLE_TEXT_RE = /[\p{L}\p{N}]/u;

const hasTranslatableText = (text: string | null): boolean =>
  TRANSLATABLE_TEXT_RE.test(text ?? "");

/** Inline content that can go out as one HTML string: no blocks or code inside. */
const isInlineRun = (el: Element): boolean =>
  !BLOCK_TAGS.has(el.tagName) &&
  !NO_TRANSLATE_TAGS.has(el.tagName) &&
  !el.querySelector([...BLOCK_TAGS, ...NO_TRANSLATE_TAGS].join(","));

/** Consecutive inline siblings, split at blocks, comments, and code. */
const collectRuns = (parent: Element, runs: Node[][]): void => {
  let run: Node[] = [];
  const flush = () => {
    if (run.some((node) => hasTranslatableText(node.textContent))) runs.push(run);
    run = [];
  };
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      run.push(child);
    } else if (child.nodeType === Node.ELEMENT_NODE && isInlineRun(child as Element)) {
      run.push(child);
    } else {
      flush();
      if (child.nodeType === Node.ELEMENT_NODE && !NO_TRANSLATE_TAGS.has((child as Element).tagName)) {
        collectRuns(child as Element, runs);
      }
    }
  }
  flush();
};

const escapeText = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const serializeRun = (run: Node[]): string =>
  run
    .map((node) =>
      node.nodeType === Node.TEXT_NODE ? escapeText(node.textContent ?? "") : (node as Element).outerHTML,
    )
    .join("");

/** Splits off surrounding whitespace so it survives providers that trim. */
const splitWhitespace = (text: string): [string, string, string] => {
  const match = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return [match?.[1] ?? "", match?.[2] ?? text, match?.[3] ?? ""];
};

const textNodes = (doc: Document): Text[] => {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (parent && !NO_TRANSLATE_TAGS.has(parent.tagName) && hasTranslatableText(node.textContent)) {
      nodes.push(node as Text);
    }
    node = walker.nextNode();
  }
  return nodes;
};

export const translateHtml = async (
  rawHtml: string,
  config: TranslationConfig,
  target: TargetLanguage,
): Promise<string> => {
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  doc.querySelectorAll("script, noscript").forEach((el) => el.remove());

  if (ENGINES[config.provider].html) {
    const runs: Node[][] = [];
    collectRuns(doc.body, runs);
    if (!runs.length) throw new Error("No message text found to translate.");
    const parts = runs.map((run) => splitWhitespace(serializeRun(run)));
    const translated = await translateTexts(parts.map(([, core]) => core), "html", config, target);
    runs.forEach((run, i) => {
      const [leading, , trailing] = parts[i]!;
      // DOMParser, not innerHTML: addons.thunderbird.net's linter flags the latter.
      const parsed = new DOMParser().parseFromString(`<body>${translated[i]}</body>`, "text/html");
      const fragment = doc.createDocumentFragment();
      fragment.append(doc.createTextNode(leading), ...parsed.body.childNodes, doc.createTextNode(trailing));
      run[0]!.parentNode!.insertBefore(fragment, run[0]!);
      run.forEach((node) => node.parentNode?.removeChild(node));
    });
  } else {
    const nodes = textNodes(doc);
    if (!nodes.length) throw new Error("No message text found to translate.");
    const parts = nodes.map((node) => splitWhitespace(node.textContent ?? ""));
    const translated = await translateTexts(parts.map(([, core]) => core), "text", config, target);
    nodes.forEach((node, i) => {
      const [leading, , trailing] = parts[i]!;
      node.textContent = `${leading}${translated[i]}${trailing}`;
    });
  }

  return doc.documentElement.outerHTML;
};

/** Plain text goes paragraph by paragraph so long messages batch like HTML. */
export const translatePlainText = async (
  text: string,
  config: TranslationConfig,
  target: TargetLanguage,
): Promise<string> => {
  const pieces = text.split(/(\n[ \t]*\n+)/);
  const indexes = pieces.flatMap((piece, i) => (i % 2 === 0 && hasTranslatableText(piece) ? [i] : []));
  const translated = await translateTexts(indexes.map((i) => pieces[i]!), "text", config, target);
  indexes.forEach((pieceIndex, i) => {
    pieces[pieceIndex] = translated[i]!;
  });
  return pieces.join("");
};

/** Where a config's requests go: its own endpoint, else the provider's default. */
const translationUrl = (config: TranslationConfig): string => {
  if (config.provider === "deepl") return deeplEndpoint(config);
  if (config.provider === "google") return GOOGLE_ENDPOINT;
  if (config.provider === "azure") return config.endpoint || AZURE_ENDPOINT;
  return config.endpoint;
};

/**
 * The host a config needs, as a match pattern. Match patterns carry no port,
 * so `http://localhost/*` covers a local model on any port.
 */
export const translationOrigin = (config: TranslationConfig): string | null => {
  try {
    const url = new URL(translationUrl(config));
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
};

/**
 * Host access is an optional permission, asked for one provider host at a
 * time when the user configures or first uses translation, so installing
 * NeoInbox grants it no network access at all. Thunderbird only shows the
 * prompt from a user gesture, so callers make this their first await, and
 * request() is called straight away: awaiting contains() first uses up the
 * gesture. request() resolves true without a prompt if access is already held.
 */
export const ensureTranslationPermission = async (config: TranslationConfig): Promise<boolean> => {
  const origin = translationOrigin(config);
  if (!origin) return false;
  return messenger.permissions.request({ origins: [origin] });
};

export const translateMessage = async (message: RawMessage): Promise<TranslationRecord> => {
  const config = getTranslationConfig();
  assertTranslationConfigured(config);
  if (!(await ensureTranslationPermission(config))) {
    const origin = translationOrigin(config);
    if (!origin) {
      throw new TranslationSetupError(
        `Add a valid ${TRANSLATION_PROVIDERS[config.provider].label} endpoint in Settings.`,
      );
    }
    throw new Error(
      `NeoInbox needs permission to reach ${new URL(origin.replace("/*", "/")).hostname} to translate.`,
    );
  }
  await pruneExpiredTranslations();

  const target = resolveTargetLanguage(config);
  const tbId = await liveTbId(message);
  if (tbId === null) throw new Error("This message could not be found.");
  const part = await messenger.messages.getFull(tbId);
  const html = extractHtmlBody(part);
  const bodyType: "text" | "html" = html ? "html" : "text";
  const raw = bodyType === "html"
    ? normalizeHtml(html ?? "")
    : normalizeText(extractRawTextBody(part) ?? "");
  if (!raw) throw new Error("No message text found to translate.");

  const rawSubject = normalizeText(message.subject);
  const bodyHash = `${bodyType}:${hashText(`${rawSubject}\n\n${raw}`)}`;
  const id = translationId(message.key, bodyHash, config, target);
  const cached = await db.translations.get(id);
  if (cached && isFreshTranslation(cached)) return cached;
  if (cached) await db.translations.delete(id);

  const [translatedSubject, translatedText] = await Promise.all([
    rawSubject
      ? translateTexts([rawSubject], "text", config, target).then(([subject]) => subject ?? "")
      : Promise.resolve(""),
    bodyType === "html"
      ? translateHtml(raw, config, target)
      : translatePlainText(raw, config, target),
  ]);
  const record: TranslationRecord = {
    id,
    messageKey: message.key,
    bodyHash,
    provider: config.provider,
    sourceLanguage: null,
    targetLanguage: target.code,
    bodyType,
    translatedSubject,
    translatedText,
    createdAt: Date.now(),
  };
  await db.translations.put(record);
  return record;
};

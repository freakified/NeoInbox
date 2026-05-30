import { db } from "../../store/db";
import type { TranslationRecord } from "../../shared/types";
import { extractRawTextBody } from "./srcdoc";

const TARGET_LANGUAGE = "en";
const TARGET_LABEL = "English";
const TRANSLATION_CONFIG_KEY = "neoinbox.translationConfig";
export const TRANSLATION_ENDPOINT_KEY = "neoinbox.translationEndpoint";

export type TranslationProvider =
  | "deepl"
  | "google"
  | "azure"
  | "libretranslate"
  | "openaiCompatible"
  | "custom";

export interface TranslationConfig {
  provider: TranslationProvider;
  apiKey: string;
  endpoint: string;
  region: string;
  model: string;
}

export const DEFAULT_TRANSLATION_CONFIG: TranslationConfig = {
  provider: "deepl",
  apiKey: "",
  endpoint: "",
  region: "",
  model: "",
};

export const TRANSLATION_PROVIDERS: Record<
  TranslationProvider,
  {
    label: string;
    needsApiKey: boolean;
    needsEndpoint: boolean;
    optionalApiKey?: boolean;
    needsRegion?: boolean;
    needsModel?: boolean;
  }
> = {
  deepl: { label: "DeepL", needsApiKey: true, needsEndpoint: false },
  google: { label: "Google Cloud Translation", needsApiKey: true, needsEndpoint: false },
  azure: { label: "Azure Translator", needsApiKey: true, needsEndpoint: false, needsRegion: true },
  libretranslate: { label: "LibreTranslate", needsApiKey: false, optionalApiKey: true, needsEndpoint: true },
  openaiCompatible: {
    label: "Local LLM (OpenAI-compatible)",
    needsApiKey: false,
    optionalApiKey: true,
    needsEndpoint: true,
    needsModel: true,
  },
  custom: { label: "Custom endpoint", needsApiKey: false, needsEndpoint: true },
};

const normalizeText = (text: string): string =>
  text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();

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

const translationId = (messageId: number, bodyHash: string): string =>
  `${messageId}:${getTranslationConfig().provider}:${TARGET_LANGUAGE}:${bodyHash}`;

const parseProvider = (value: unknown): TranslationProvider =>
  value === "deepl" ||
  value === "google" ||
  value === "azure" ||
  value === "libretranslate" ||
  value === "openaiCompatible" ||
  value === "custom"
    ? value
    : DEFAULT_TRANSLATION_CONFIG.provider;

export const getTranslationConfig = (): TranslationConfig => {
  const raw = localStorage.getItem(TRANSLATION_CONFIG_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<TranslationConfig>;
      return {
        provider: parseProvider(parsed.provider),
        apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
        endpoint: typeof parsed.endpoint === "string" ? parsed.endpoint : "",
        region: typeof parsed.region === "string" ? parsed.region : "",
        model: typeof parsed.model === "string" ? parsed.model : "",
      };
    } catch {
      // Fall through to legacy endpoint migration.
    }
  }

  const legacyEndpoint = localStorage.getItem(TRANSLATION_ENDPOINT_KEY)?.trim() ?? "";
  if (legacyEndpoint) {
    return {
      ...DEFAULT_TRANSLATION_CONFIG,
      provider: "custom",
      endpoint: legacyEndpoint,
    };
  }

  return DEFAULT_TRANSLATION_CONFIG;
};

export const setTranslationConfig = (config: TranslationConfig): void => {
  const normalized: TranslationConfig = {
    provider: config.provider,
    apiKey: config.apiKey.trim(),
    endpoint: config.endpoint.trim(),
    region: config.region.trim(),
    model: config.model.trim(),
  };
  localStorage.setItem(TRANSLATION_CONFIG_KEY, JSON.stringify(normalized));
  localStorage.removeItem(TRANSLATION_ENDPOINT_KEY);
};

export const getTranslationEndpoint = (): string =>
  getTranslationConfig().endpoint;

export const setTranslationEndpoint = (endpoint: string): void => {
  setTranslationConfig({
    ...getTranslationConfig(),
    provider: "custom",
    endpoint,
  });
};

const parseTranslatedText = (payload: unknown): string => {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const value = record.translatedText ?? record.translation ?? record.text;
  return typeof value === "string" ? value.trim() : "";
};

const parseDeepLText = (payload: unknown): string => {
  const translations = (payload as { translations?: Array<{ text?: unknown }> }).translations;
  const text = translations?.[0]?.text;
  return typeof text === "string" ? text.trim() : "";
};

const parseGoogleText = (payload: unknown): string => {
  const translations = (payload as {
    data?: { translations?: Array<{ translatedText?: unknown }> };
  }).data?.translations;
  const text = translations?.[0]?.translatedText;
  return typeof text === "string" ? decodeHtmlEntities(text).trim() : "";
};

const parseAzureText = (payload: unknown): string => {
  const translations = (payload as Array<{ translations?: Array<{ text?: unknown }> }>)?.[0]?.translations;
  const text = translations?.[0]?.text;
  return typeof text === "string" ? text.trim() : "";
};

const parseOpenAICompatibleText = (payload: unknown): string => {
  const content = (payload as {
    choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
  })?.choices?.[0];
  const value = content?.message?.content ?? content?.text;
  return typeof value === "string" ? value.trim() : "";
};

const decodeHtmlEntities = (text: string): string => {
  const doc = new DOMParser().parseFromString(text, "text/html");
  return doc.documentElement.textContent ?? text;
};

const requireApiKey = (config: TranslationConfig): string => {
  if (!config.apiKey) {
    throw new Error(`Add a ${TRANSLATION_PROVIDERS[config.provider].label} API key in Settings.`);
  }
  return config.apiKey;
};

const requireEndpoint = (config: TranslationConfig): string => {
  if (!config.endpoint) {
    throw new Error(`Add a ${TRANSLATION_PROVIDERS[config.provider].label} endpoint in Settings.`);
  }
  return config.endpoint;
};

const fetchJson = async (url: string, init: RequestInit): Promise<unknown> => {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Translation failed with HTTP ${res.status}`);
  return res.json();
};

const requestCustomTranslation = async (
  text: string,
  config: TranslationConfig,
): Promise<string> => {
  const endpoint = requireEndpoint(config);
  const translated = parseTranslatedText(await fetchJson(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      targetLanguage: TARGET_LANGUAGE,
      targetLabel: TARGET_LABEL,
    }),
  }));
  if (!translated) throw new Error("Translation response did not include translated text.");
  return translated;
};

const requestLibreTranslate = async (
  text: string,
  config: TranslationConfig,
): Promise<string> => {
  const endpoint = requireEndpoint(config);
  const translated = parseTranslatedText(await fetchJson(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      q: text,
      source: "auto",
      target: TARGET_LANGUAGE,
      format: "text",
      api_key: config.apiKey || undefined,
    }),
  }));
  if (!translated) throw new Error("Translation response did not include translated text.");
  return translated;
};

const requestDeepL = async (
  text: string,
  config: TranslationConfig,
): Promise<string> => {
  const endpoint = config.endpoint || "https://api-free.deepl.com/v2/translate";
  const body = new URLSearchParams({
    text,
    target_lang: TARGET_LANGUAGE.toUpperCase(),
  });
  const translated = parseDeepLText(await fetchJson(endpoint, {
    method: "POST",
    headers: {
      authorization: `DeepL-Auth-Key ${requireApiKey(config)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  }));
  if (!translated) throw new Error("DeepL response did not include translated text.");
  return translated;
};

const requestGoogle = async (
  text: string,
  config: TranslationConfig,
): Promise<string> => {
  const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(requireApiKey(config))}`;
  const translated = parseGoogleText(await fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      q: text,
      target: TARGET_LANGUAGE,
      format: "text",
    }),
  }));
  if (!translated) throw new Error("Google response did not include translated text.");
  return translated;
};

const requestAzure = async (
  text: string,
  config: TranslationConfig,
): Promise<string> => {
  const endpoint = (config.endpoint || "https://api.cognitive.microsofttranslator.com").replace(/\/$/, "");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "ocp-apim-subscription-key": requireApiKey(config),
  };
  if (config.region) headers["ocp-apim-subscription-region"] = config.region;
  const translated = parseAzureText(await fetchJson(
    `${endpoint}/translate?api-version=3.0&to=${TARGET_LANGUAGE}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify([{ text }]),
    },
  ));
  if (!translated) throw new Error("Azure response did not include translated text.");
  return translated;
};

const requestOpenAICompatible = async (
  text: string,
  config: TranslationConfig,
): Promise<string> => {
  const endpoint = (config.endpoint || "http://localhost:1234/v1/chat/completions").trim();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

  const translated = parseOpenAICompatibleText(await fetchJson(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model || "local-model",
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: [
            `Translate the user's email message to ${TARGET_LABEL}.`,
            "Return only the translated message text.",
            "Preserve paragraph breaks, links, dates, names, and quoted text.",
          ].join(" "),
        },
        { role: "user", content: text },
      ],
    }),
  }));
  if (!translated) throw new Error("Local LLM response did not include translated text.");
  return translated;
};

const requestTranslation = async (text: string): Promise<string> => {
  const config = getTranslationConfig();
  if (config.provider === "deepl") return requestDeepL(text, config);
  if (config.provider === "google") return requestGoogle(text, config);
  if (config.provider === "azure") return requestAzure(text, config);
  if (config.provider === "libretranslate") return requestLibreTranslate(text, config);
  if (config.provider === "openaiCompatible") return requestOpenAICompatible(text, config);

  const endpoint = config.endpoint;
  if (!endpoint) {
    throw new Error(
      "Translation provider is not configured. Add a translation endpoint in Settings.",
    );
  }
  return requestCustomTranslation(text, config);
};

export const translateMessageToEnglish = async (
  messageId: number,
): Promise<TranslationRecord> => {
  const part = await messenger.messages.getFull(messageId);
  const raw = normalizeText(extractRawTextBody(part) ?? "");
  if (!raw) throw new Error("No message text found to translate.");

  const bodyHash = hashText(raw);
  const id = translationId(messageId, bodyHash);
  const cached = await db.translations.get(id);
  if (cached) return cached;

  const translatedText = await requestTranslation(raw);
  const record: TranslationRecord = {
    id,
    messageId,
    bodyHash,
    provider: getTranslationConfig().provider,
    sourceLanguage: null,
    targetLanguage: TARGET_LANGUAGE,
    translatedText,
    createdAt: Date.now(),
  };
  await db.translations.put(record);
  return record;
};

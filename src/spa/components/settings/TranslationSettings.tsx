import { useState } from "react";
import { Icon } from "../Icon";
import { useMailStore } from "../../../store/mailStore";
import {
  DEFAULT_TRANSLATION_CONFIG,
  ensureTranslationPermission,
  getTranslationConfig,
  setTranslationConfig,
  TRANSLATION_PROVIDERS,
  type TranslationConfig,
  type TranslationProvider,
} from "../../lib/translation";
import s from "../BundleManagerModal.module.css";

const sameTranslationConfig = (a: TranslationConfig, b: TranslationConfig): boolean =>
  a.provider === b.provider &&
  a.apiKey === b.apiKey &&
  a.endpoint === b.endpoint &&
  a.region === b.region &&
  a.model === b.model;

const TranslationSection = () => {
  const notify = useMailStore((st) => st.notify);
  const [config, setConfig] = useState<TranslationConfig>(() => getTranslationConfig());

  const saved = getTranslationConfig();
  const normalized: TranslationConfig = {
    provider: config.provider,
    apiKey: config.apiKey.trim(),
    endpoint: config.endpoint.trim(),
    region: config.region.trim(),
    model: config.model.trim(),
  };
  const providerMeta = TRANSLATION_PROVIDERS[config.provider];
  const hasChanges = !sameTranslationConfig(normalized, saved);

  const updateConfig = (patch: Partial<TranslationConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  };

  const save = () => {
    // Ask for the provider's host now, while the click still counts as a
    // user gesture; a translate click asks again if this one is declined.
    void ensureTranslationPermission(normalized)
      .catch(() => false)
      .then((granted) => {
        notify(
          granted
            ? "Translation settings saved"
            : "Translation settings saved — NeoInbox will ask for access when you translate",
        );
      });
    setTranslationConfig(normalized);
    setConfig(normalized);
  };

  const reset = () => {
    setTranslationConfig(DEFAULT_TRANSLATION_CONFIG);
    setConfig(DEFAULT_TRANSLATION_CONFIG);
    notify("Translation settings reset");
  };

  const endpointPlaceholder =
    config.provider === "deepl"
      ? "https://api-free.deepl.com/v2/translate"
      : config.provider === "azure"
        ? "https://api.cognitive.microsofttranslator.com"
        : config.provider === "libretranslate"
          ? "https://libretranslate.com/translate"
          : config.provider === "openaiCompatible"
            ? "http://localhost:1234/v1/chat/completions"
            : "https://example.com/translate";

  return (
    <section className={s.section}>
      <p className={s.helpText}>Text is only sent when you click Translate.</p>
      <label className={s.fieldBlock}>
        <span className={s.label}>Service</span>
        <select
          className={s.select}
          value={config.provider}
          onChange={(e) => updateConfig({ provider: e.target.value as TranslationProvider })}
        >
          {(Object.keys(TRANSLATION_PROVIDERS) as TranslationProvider[]).map((provider) => (
            <option key={provider} value={provider}>
              {TRANSLATION_PROVIDERS[provider].label}
            </option>
          ))}
        </select>
      </label>
      {(providerMeta.needsApiKey || providerMeta.optionalApiKey) && (
        <label className={s.fieldBlock}>
          <span className={s.label}>
            {providerMeta.optionalApiKey ? "API key (optional)" : "API key"}
          </span>
          <input
            type="password"
            className={s.input}
            value={config.apiKey}
            placeholder={`${providerMeta.label} API key`}
            onChange={(e) => updateConfig({ apiKey: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </label>
      )}
      {(providerMeta.needsEndpoint || config.provider === "deepl" || config.provider === "azure") && (
        <label className={s.fieldBlock}>
          <span className={s.label}>
            {providerMeta.needsEndpoint ? "Endpoint" : "Endpoint override"}
          </span>
          <input
            type="url"
            className={s.input}
            value={config.endpoint}
            placeholder={endpointPlaceholder}
            onChange={(e) => updateConfig({ endpoint: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </label>
      )}
      {providerMeta.needsRegion && (
        <label className={s.fieldBlock}>
          <span className={s.label}>Region</span>
          <input
            type="text"
            className={s.input}
            value={config.region}
            placeholder="global, eastus, westeurope..."
            onChange={(e) => updateConfig({ region: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </label>
      )}
      {providerMeta.needsModel && (
        <label className={s.fieldBlock}>
          <span className={s.label}>Model</span>
          <input
            type="text"
            className={s.input}
            value={config.model}
            placeholder="local-model"
            onChange={(e) => updateConfig({ model: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </label>
      )}
      {config.provider === "custom" && (
        <p className={s.helpText}>
          Takes JSON {"{"} text, targetLanguage {"}"} and returns {"{"} translatedText {"}"}.
        </p>
      )}
      {config.provider === "openaiCompatible" && (
        <p className={s.helpText}>
          Use LM Studio's OpenAI-compatible endpoint.
        </p>
      )}
      {config.provider === "libretranslate" && (
        <p className={s.helpText}>
          Any LibreTranslate-compatible endpoint.
        </p>
      )}
      <div className={s.formActions}>
        <button type="button" className={s.saveBtn} disabled={!hasChanges} onClick={save}>
          Save
        </button>
        <button type="button" className={s.textBtn} onClick={reset}>
          Reset
        </button>
      </div>
    </section>
  );
};

export const TranslationSettings = () => (
  <div className={s.editor}>
    <div className={s.editorHeader}>
      <Icon name="translate" className={s.editorIcon} />
      <h3 className={s.editorTitle}>Translation</h3>
    </div>
    <TranslationSection />
  </div>
);

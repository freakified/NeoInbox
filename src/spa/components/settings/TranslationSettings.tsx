import { useState } from "react";
import { Icon } from "../Icon";
import { useMailStore } from "../../../store/mailStore";
import {
  DEFAULT_TRANSLATION_CONFIG,
  ensureTranslationPermission,
  getTranslationConfig,
  setTranslationConfig,
  TARGET_LANGUAGES,
  TRANSLATION_PROVIDERS,
  uiTargetLanguage,
  type TranslationConfig,
  type TranslationProvider,
} from "../../lib/translation";
import s from "../BundleManagerModal.module.css";

const sameTranslationConfig = (a: TranslationConfig, b: TranslationConfig): boolean =>
  a.provider === b.provider &&
  a.apiKey === b.apiKey &&
  a.endpoint === b.endpoint &&
  a.region === b.region &&
  a.model === b.model &&
  a.targetLanguage === b.targetLanguage;

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
    targetLanguage: config.targetLanguage,
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

  return (
    <section className={s.section}>
      <p className={s.helpText}>Text is only sent when you click Translate.</p>
      <label className={s.fieldBlock}>
        <span className={s.label}>Translate into</span>
        <select
          className={s.select}
          value={config.targetLanguage}
          onChange={(e) => updateConfig({ targetLanguage: e.target.value })}
        >
          <option value="">Thunderbird's language ({uiTargetLanguage().label})</option>
          {TARGET_LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>
      </label>
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
      {providerMeta.apiKey !== "none" && (
        <label className={s.fieldBlock}>
          <span className={s.label}>
            {providerMeta.apiKey === "optional" ? "API key (optional)" : "API key"}
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
      {providerMeta.endpoint !== "none" && (
        <label className={s.fieldBlock}>
          <span className={s.label}>
            {providerMeta.endpoint === "override" ? "Endpoint override (optional)" : "Endpoint"}
          </span>
          <input
            type="url"
            className={s.input}
            value={config.endpoint}
            placeholder={providerMeta.endpointPlaceholder}
            onChange={(e) => updateConfig({ endpoint: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </label>
      )}
      {providerMeta.region && (
        <label className={s.fieldBlock}>
          <span className={s.label}>Region (optional)</span>
          <input
            type="text"
            className={s.input}
            value={config.region}
            placeholder="Leave blank for a global resource, e.g. eastus, westeurope"
            onChange={(e) => updateConfig({ region: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </label>
      )}
      {providerMeta.model && (
        <label className={s.fieldBlock}>
          <span className={s.label}>Model</span>
          <input
            type="text"
            className={s.input}
            value={config.model}
            placeholder="e.g. gemma3, llama3.2, qwen3"
            onChange={(e) => updateConfig({ model: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </label>
      )}
      {providerMeta.helpText && <p className={s.helpText}>{providerMeta.helpText}</p>}
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

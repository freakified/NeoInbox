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
  a.enabled === b.enabled &&
  a.provider === b.provider &&
  a.apiKey === b.apiKey &&
  a.endpoint === b.endpoint &&
  a.region === b.region &&
  a.model === b.model &&
  a.targetLanguage === b.targetLanguage;

const TranslationSection = () => {
  const notify = useMailStore((st) => st.notify);
  const closeSettings = useMailStore((st) => st.closeBundleSettings);
  const [config, setConfig] = useState<TranslationConfig>(() => getTranslationConfig());

  const saved = getTranslationConfig();
  const normalized: TranslationConfig = {
    enabled: config.enabled,
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

  // Swap in the new provider's usual endpoint, unless the user typed their own.
  const changeProvider = (provider: TranslationProvider) => {
    const typed = config.endpoint.trim() !== (providerMeta.defaultEndpoint ?? "");
    updateConfig({
      provider,
      endpoint: typed ? config.endpoint : TRANSLATION_PROVIDERS[provider].defaultEndpoint ?? "",
    });
  };

  const save = () => {
    // Enter in a field lands here too; with nothing to save it shouldn't close.
    if (!hasChanges) return;
    setTranslationConfig(normalized);
    if (!normalized.enabled) {
      notify("Translation turned off");
      closeSettings();
      return;
    }
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
    closeSettings();
  };

  const reset = () => {
    setTranslationConfig(DEFAULT_TRANSLATION_CONFIG);
    setConfig(DEFAULT_TRANSLATION_CONFIG);
    notify("Translation settings reset");
  };

  return (
    <>
      <section className={s.section}>
        <h4 className={s.sectionTitle}>General</h4>
        <div className={s.policyChoices}>
          <label className={s.policyChoice}>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => updateConfig({ enabled: e.target.checked })}
              className={s.checkInput}
            />
            <span>Enable translation</span>
          </label>
        </div>
        {config.enabled && (
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
        )}
      </section>
      {config.enabled && (
        <section className={s.section}>
          <h4 className={s.sectionTitle}>Translation Service</h4>
          <p className={s.helpText}>
            Email content is sent to the service you specify only when you click "Translate".
          </p>
          <label className={s.fieldBlock}>
            <span className={s.label}>Service</span>
            <select
              className={s.select}
              value={config.provider}
              onChange={(e) => changeProvider(e.target.value as TranslationProvider)}
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
        </section>
      )}
      <div className={s.formActions}>
        <button type="button" className={s.saveBtn} disabled={!hasChanges} onClick={save}>
          Save
        </button>
        <button type="button" className={s.textBtn} onClick={reset}>
          Reset
        </button>
      </div>
    </>
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

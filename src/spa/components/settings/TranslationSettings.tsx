import { clsx } from "clsx";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import {
  ensureTranslationPermission,
  getTranslationConfig,
  setTranslationConfig,
  TARGET_LANGUAGES,
  TRANSLATION_PROVIDERS,
  translationOrigin,
  uiTargetLanguage,
  type TranslationConfig,
  type TranslationProvider,
} from "../../lib/translation";
import { getOpenMode } from "../../../shared/openMode";
import s from "../BundleManagerModal.module.css";

const sameTranslationConfig = (a: TranslationConfig, b: TranslationConfig): boolean =>
  a.enabled === b.enabled &&
  a.provider === b.provider &&
  a.apiKey === b.apiKey &&
  a.endpoint === b.endpoint &&
  a.region === b.region &&
  a.model === b.model &&
  a.targetLanguage === b.targetLanguage;

/**
 * Whether NeoInbox can reach the host this config translates through. Host
 * access is asked for apart from saving: fields save as they change, but
 * only a click can raise the permission prompt.
 */
const HostAccess = ({ config }: { config: TranslationConfig }) => {
  const origin = translationOrigin(config);
  const [granted, setGranted] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);
  // Thunderbird shows the prompt in its main window, which a window of our
  // own can hide.
  const [ownWindow, setOwnWindow] = useState(false);
  useEffect(() => {
    void getOpenMode().then((mode) => setOwnWindow(mode === "window"));
  }, []);

  useEffect(() => {
    setGranted(null);
    if (!origin) return;
    let live = true;
    void messenger.permissions
      .contains({ origins: [origin] })
      .catch(() => false)
      .then((has) => live && setGranted(has));
    return () => {
      live = false;
    };
  }, [origin]);

  if (!origin || granted === null) return null;
  const host = new URL(origin.replace("/*", "/")).hostname;
  if (granted) {
    return (
      <div className={clsx(s.status, s.statusOk)}>
        <Icon name="check_circle" className={s.statusIcon} />
        <span>NeoInbox can reach {host}.</span>
      </div>
    );
  }

  const allow = () => {
    setAsking(true);
    void ensureTranslationPermission(config)
      .catch(() => false)
      .then((has) => {
        setAsking(false);
        setGranted(has);
      });
  };
  return (
    <div className={clsx(s.status, s.statusWarn)}>
      <Icon name="warning" className={s.statusIcon} />
      <span>NeoInbox needs access to {host}.</span>
      <button type="button" className={clsx(s.primaryBtn, s.statusButton)} onClick={allow}>
        Allow access
      </button>
      {asking && ownWindow && (
        <span className={clsx(s.helpText, s.statusNote)}>
          Check your main Thunderbird window to allow access.
        </span>
      )}
    </div>
  );
};

/** Choices save on change; typed fields save when they lose focus, on Enter, or on close. */
const TranslationSection = () => {
  const [config, setConfig] = useState<TranslationConfig>(() => getTranslationConfig());
  const [saved, setSaved] = useState<TranslationConfig>(() => getTranslationConfig());
  const providerMeta = TRANSLATION_PROVIDERS[config.provider];

  const commit = (next: TranslationConfig) => {
    if (sameTranslationConfig(next, getTranslationConfig())) return;
    setTranslationConfig(next);
    setSaved(getTranslationConfig());
  };

  // Escape or a click outside unmounts the pane without blurring the field.
  const latest = useRef(config);
  latest.current = config;
  useEffect(() => () => commit(latest.current), []);

  const updateConfig = (patch: Partial<TranslationConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  };

  const updateAndCommit = (patch: Partial<TranslationConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    commit(next);
  };

  // Swap in the new provider's usual endpoint, unless the user typed their own.
  const changeProvider = (provider: TranslationProvider) => {
    const typed = config.endpoint.trim() !== (providerMeta.defaultEndpoint ?? "");
    updateAndCommit({
      provider,
      endpoint: typed ? config.endpoint : TRANSLATION_PROVIDERS[provider].defaultEndpoint ?? "",
    });
  };

  const fieldProps = {
    onBlur: () => commit(config),
    onKeyDown: (e: KeyboardEvent) => e.key === "Enter" && commit(config),
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
              onChange={(e) => updateAndCommit({ enabled: e.target.checked })}
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
              onChange={(e) => updateAndCommit({ targetLanguage: e.target.value })}
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
                {...fieldProps}
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
                {...fieldProps}
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
                {...fieldProps}
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
                {...fieldProps}
              />
            </label>
          )}
          {providerMeta.helpText && <p className={s.helpText}>{providerMeta.helpText}</p>}
          <HostAccess config={saved} />
        </section>
      )}
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

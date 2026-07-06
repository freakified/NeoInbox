import { clsx } from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CATEGORIES, getCategoryMeta } from "../../shared/categories";
import {
  findRouteRule,
  matchingRouteRules,
  normalizeRuleValue,
  ruleTypeLabel,
} from "../../shared/routeRules";
import { parseSender } from "../../shared/senders";
import type {
  BuiltinCategory,
  Category,
  RouteRuleRecord,
  RouteRuleType,
  Thread,
} from "../../shared/types";
import { useCustomBundles, useMailStore, useRouteRules } from "../../store/mailStore";
import { setShowDeleteActions, useShowDeleteActions } from "../lib/deleteActionPrefs";
import {
  getRemoteImagePolicy,
  listTrustedImageSenders,
  type RemoteImagePolicy,
  setRemoteImagePolicy,
  subscribeTrustedImageSenders,
  trustImageSender,
  untrustImageSender,
} from "../lib/remoteImagePrefs";
import {
  DEFAULT_TRANSLATION_CONFIG,
  getTranslationConfig,
  setTranslationConfig,
  TRANSLATION_PROVIDERS,
  type TranslationConfig,
  type TranslationProvider,
} from "../lib/translation";
import { Icon } from "./Icon";
import s from "./BundleManagerModal.module.css";

type RuleType = RouteRuleType;
interface DraftRule {
  type: RuleType;
  value: string;
}
type SelectedBundle = { kind: "builtin"; id: BuiltinCategory } | { kind: "custom"; id: string } | { kind: "new" };
type SelectedPane = { kind: "general" } | { kind: "remoteImages" } | { kind: "translation" } | SelectedBundle;

interface BundleFormState {
  id: string;
  name: string;
  color: string;
  icon: string;
  draftRules: DraftRule[];
  order: number;
}

/** Includes "personal" (the unbundled Inbox), sorted last, so its rules stay manageable. */
const BUNDLE_CATEGORIES = Object.entries(CATEGORIES)
  .sort(([, a], [, b]) => a.order - b.order)
  .map(([cat]) => cat as BuiltinCategory);

const PRESET_COLORS = [
  "#4285F4", "#34A853", "#FBBC04", "#EA4335",
  "#FF6D01", "#9C27B0", "#00BCD4", "#795548", "#174EA6",
  "#607D8B", "#E91E63", "#009688", "#673AB7",
];

const CUSTOM_BUNDLE_ICON_GROUPS = [
  {
    label: "General",
    icons: [
      "label", "label_important", "local_offer", "sell", "flag", "bookmark", "star", "favorite",
      "push_pin", "priority_high", "bolt", "auto_awesome", "category", "dashboard", "widgets",
      "folder", "folder_open", "inventory_2", "archive", "history", "schedule", "event", "calendar_month",
    ],
  },
  {
    label: "Mail",
    icons: [
      "inbox", "mail", "drafts", "send", "outbox", "mark_email_unread", "forward_to_inbox",
      "unsubscribe", "notifications", "notifications_active", "campaign", "rss_feed", "alternate_email",
      "contact_mail", "contact_phone", "quickreply",
    ],
  },
  {
    label: "Work",
    icons: [
      "work", "business", "corporate_fare", "badge", "assignment", "assignment_turned_in", "task_alt",
      "checklist", "description", "article", "fact_check", "approval", "groups", "meeting_room",
      "support_agent", "engineering", "construction", "build", "handyman", "print", "scanner",
    ],
  },
  {
    label: "Money",
    icons: [
      "account_balance", "finance_mode", "credit_card", "account_balance_wallet", "savings", "receipt",
      "receipt_long", "payments", "paid", "attach_money", "price_check", "request_quote",
      "trending_up", "trending_down", "query_stats", "monitoring", "currency_exchange", "calculate",
    ],
  },
  {
    label: "Shopping",
    icons: [
      "shopping_bag", "shopping_cart", "add_shopping_cart", "storefront", "store", "redeem",
      "card_giftcard", "sell", "loyalty", "barcode_scanner", "qr_code_scanner", "local_shipping",
      "package_2", "inventory", "warehouse", "confirmation_number",
    ],
  },
  {
    label: "Travel",
    icons: [
      "flight", "travel", "hotel", "luggage", "map", "explore", "near_me", "public", "language",
      "directions_car", "train", "directions_bus", "directions_boat", "local_taxi", "commute",
      "airport_shuttle", "restaurant", "local_cafe", "local_bar", "attractions",
    ],
  },
  {
    label: "People",
    icons: [
      "group", "person", "contacts", "account_circle", "supervisor_account", "diversity_3",
      "family_restroom", "forum", "chat", "chat_bubble", "sms", "reviews", "thumb_up", "volunteer_activism",
      "favorite", "celebration",
    ],
  },
  {
    label: "Learning",
    icons: [
      "school", "local_library", "menu_book", "book", "history_edu", "science", "biotech",
      "psychology", "lightbulb", "tips_and_updates", "extension", "code", "terminal", "data_object",
      "memory", "smart_toy",
    ],
  },
  {
    label: "Lifestyle",
    icons: [
      "home", "apartment", "chair", "kitchen", "yard", "restaurant_menu", "cake", "fitness_center",
      "health_and_safety", "medical_services", "spa", "self_improvement", "music_note", "movie",
      "theaters", "photo_camera", "palette", "brush", "sports_esports", "sports_soccer", "sports_basketball",
      "hiking", "pets",
    ],
  },
  {
    label: "Tech",
    icons: [
      "computer", "desktop_mac", "laptop_mac", "smartphone", "tablet_mac", "devices", "router",
      "wifi", "cloud", "cloud_sync", "sync", "backup", "download", "upload", "security", "key",
      "lock", "vpn_key", "shield", "bug_report", "settings", "tune",
    ],
  },
] as const;

const CUSTOM_BUNDLE_ICONS: readonly string[] = [
  ...new Set(CUSTOM_BUNDLE_ICON_GROUPS.flatMap((group) => group.icons)),
];

const ruleDescription = (type: RuleType): string => {
  if (type === "domain") return "Matches any sender at this domain.";
  if (type === "email") return "Matches this exact sender address.";
  return "Matches when the subject includes this text anywhere.";
};

const rulePreview = (type: RuleType, value: string): string => {
  const normalized = normalizeRuleValue(type, value);
  if (!normalized) return ruleDescription(type);
  if (type === "domain") return `Sender domain is ${normalized}`;
  if (type === "email") return `Sender is ${normalized}`;
  return `Subject contains "${normalized}"`;
};

const emptyForm = (order: number, seedRule?: DraftRule): BundleFormState => ({
  id: crypto.randomUUID(),
  name: "",
  color: PRESET_COLORS[0]!,
  icon: "label",
  draftRules: seedRule ? [seedRule] : [],
  order,
});

const bundleKey = (selected: SelectedBundle): string =>
  selected.kind === "new" ? "new" : `${selected.kind}:${selected.id}`;

const paneKey = (selected: SelectedPane): string =>
  selected.kind === "general" || selected.kind === "remoteImages" || selected.kind === "translation"
    ? selected.kind
    : bundleKey(selected);

const hasDraftRule = (rules: readonly DraftRule[], rule: DraftRule): boolean =>
  rules.some((r) => r.type === rule.type && r.value === rule.value);

/** Winner-first thread matches → per-rule badge; undefined when the rule doesn't match. */
type RuleBadge = "wins" | "outranked";
const threadBadge = (
  matches: readonly RouteRuleRecord[],
  ruleId: string,
): RuleBadge | undefined =>
  matches[0]?.id === ruleId
    ? "wins"
    : matches.some((r) => r.id === ruleId)
      ? "outranked"
      : undefined;

export const BundleManagerModal = ({
  onClose,
  thread,
  initialCategory,
  startNewBundle,
  highlightRuleId,
}: {
  onClose: () => void;
  thread?: Thread;
  initialCategory?: Category | null;
  startNewBundle?: boolean;
  highlightRuleId?: string;
}) => {
  const customBundles = useCustomBundles();
  const routeRules = useRouteRules();
  const setRouteRule = useMailStore((st) => st.setRouteRule);
  const setCustomBundle = useMailStore((st) => st.setCustomBundle);
  const deleteCustomBundle = useMailStore((st) => st.deleteCustomBundle);
  const notify = useMailStore((st) => st.notify);

  const sender = useMemo(
    () => parseSender(thread?.messages[0]?.author ?? ""),
    [thread],
  );
  /** Every rule matching this thread, winner first; drives badges and the summary. */
  const threadMatches = useMemo(
    () =>
      thread
        ? matchingRouteRules(routeRules, {
            senderEmail: sender.email,
            senderDomain: sender.domain,
            subject: thread.subject,
          })
        : [],
    [thread, routeRules, sender],
  );
  const threadRuleDefaults: Record<RuleType, string> = {
    domain: sender.domain,
    email: sender.email,
    subject_keyword: thread?.subject ?? "",
  };
  const initialRuleType: RuleType = sender.domain ? "domain" : sender.email ? "email" : "subject_keyword";
  const initialRuleValue = thread ? normalizeRuleValue(initialRuleType, threadRuleDefaults[initialRuleType]) : "";
  const seededRule = initialRuleValue ? { type: initialRuleType, value: initialRuleValue } : undefined;

  const initialSelected = (): SelectedBundle => {
    if (startNewBundle) return { kind: "new" };
    if (initialCategory && BUNDLE_CATEGORIES.includes(initialCategory as BuiltinCategory)) {
      return { kind: "builtin", id: initialCategory as BuiltinCategory };
    }
    if (initialCategory && customBundles.some((b) => b.id === initialCategory)) {
      return { kind: "custom", id: initialCategory };
    }
    return { kind: "builtin", id: thread ? "personal" : "updates" };
  };

  const selectedAtOpen: SelectedPane =
    thread || initialCategory || startNewBundle ? initialSelected() : { kind: "general" };
  const initialForm = (): BundleFormState => {
    if (selectedAtOpen.kind === "custom") {
      const bundle = customBundles.find((b) => b.id === selectedAtOpen.id);
      if (bundle) {
        return {
          id: bundle.id,
          name: bundle.name,
          color: bundle.color,
          icon: bundle.icon,
          draftRules: [],
          order: bundle.order,
        };
      }
    }
    return emptyForm(10 + customBundles.length, selectedAtOpen.kind === "new" ? seededRule : undefined);
  };

  const [selected, setSelected] = useState<SelectedPane>(selectedAtOpen);
  const [form, setForm] = useState<BundleFormState>(initialForm);
  const [ruleType, setRuleType] = useState<RuleType>(initialRuleType);
  const [ruleValue, setRuleValue] = useState(initialRuleValue);

  const selectedCustom = selected.kind === "custom"
    ? customBundles.find((b) => b.id === selected.id) ?? null
    : null;
  const currentForm = form;

  const choose = (next: SelectedPane) => {
    setSelected(next);
    if (next.kind === "custom") {
      const bundle = customBundles.find((b) => b.id === next.id);
      if (bundle) {
        setForm({
          id: bundle.id,
          name: bundle.name,
          color: bundle.color,
          icon: bundle.icon,
          draftRules: [],
          order: bundle.order,
        });
      }
    } else if (next.kind === "new") {
      const activeRuleValue = normalizeRuleValue(ruleType, ruleValue);
      const activeRule = activeRuleValue ? { type: ruleType, value: activeRuleValue } : seededRule;
      setForm(emptyForm(10 + customBundles.length, activeRule));
    }
  };

  const targetName = (target: Category): string => getCategoryMeta(target, customBundles).name;

  /** The destination the composer's rules would go to; null while drafting a new bundle. */
  const selectedTarget: Category | null =
    selected.kind === "builtin" ? selected.id : selected.kind === "custom" ? selected.id : null;

  const composerValue = normalizeRuleValue(ruleType, ruleValue);
  const composerConflict = composerValue
    ? findRouteRule(routeRules, ruleType, composerValue)
    : undefined;
  const conflictNote =
    composerConflict && composerConflict.target !== selectedTarget
      ? `Currently routed to ${targetName(composerConflict.target)} — adding it here will move it.`
      : undefined;

  const saveForm = () => {
    const name = currentForm.name.trim();
    if (!name) return;
    setCustomBundle({
      id: currentForm.id,
      name,
      color: currentForm.color,
      icon: currentForm.icon,
      order: currentForm.order,
    });
    if (selected.kind === "new") {
      for (const draft of currentForm.draftRules) {
        setRouteRule({
          id: crypto.randomUUID(),
          target: currentForm.id,
          type: draft.type,
          value: draft.value,
          createdAt: Date.now(),
        });
      }
    }
    notify(selected.kind === "new" ? `Created ${name}` : `Updated ${name}`);
    if (selected.kind === "new") setSelected({ kind: "custom", id: currentForm.id });
  };

  const removeCustom = () => {
    if (!selectedCustom) return;
    deleteCustomBundle(selectedCustom.id);
    notify(`Deleted ${selectedCustom.name}`);
    setSelected({ kind: "builtin", id: "updates" });
  };

  const updateForm = (patch: Partial<BundleFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const removeDraftRule = (idx: number) => {
    setForm((prev) => ({ ...prev, draftRules: prev.draftRules.filter((_, i) => i !== idx) }));
  };

  const addRule = () => {
    const value = normalizeRuleValue(ruleType, ruleValue);
    if (!value) return;
    if (selected.kind === "new") {
      const draft = { type: ruleType, value };
      if (hasDraftRule(currentForm.draftRules, draft)) {
        notify("This bundle already has that rule");
      } else {
        setForm((prev) => ({ ...prev, draftRules: [...prev.draftRules, draft] }));
      }
    } else if (selectedTarget) {
      const previous = findRouteRule(routeRules, ruleType, value);
      const name = targetName(selectedTarget);
      if (previous?.target === selectedTarget) {
        notify(`${value} is already routed to ${name}`);
        return;
      }
      setRouteRule({
        id: crypto.randomUUID(),
        target: selectedTarget,
        type: ruleType,
        value,
        createdAt: Date.now(),
      });
      notify(
        previous
          ? `Moved ${value} from ${targetName(previous.target)} to ${name}`
          : `Rule added to ${name}`,
      );
    }
    setRuleValue(thread ? normalizeRuleValue(ruleType, threadRuleDefaults[ruleType]) : "");
  };

  const setThreadRule = (type: RuleType) => {
    setRuleType(type);
    setRuleValue(thread ? threadRuleDefaults[type] : "");
  };

  const modal = (
    <div
      className={s.overlay}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className={s.dialog} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className={s.head}>
          <div>
            <h2 className={s.title}>Settings</h2>
            {thread && <p className={s.subtitle}>Add rules from this thread or manage any bundle.</p>}
          </div>
          <button type="button" className={s.closeBtn} onClick={onClose} aria-label="Close">
            <Icon name="close" className={s.closeIcon} />
          </button>
        </div>

        <div className={s.body}>
          <aside className={s.sidebar}>
            <button
              type="button"
              className={clsx(s.bundleNavItem, paneKey(selected) === "general" && s.bundleNavItemActive)}
              onClick={() => choose({ kind: "general" })}
            >
              <Icon name="settings" className={s.navIcon} />
              <span className={s.navName}>General</span>
            </button>
            <button
              type="button"
              className={clsx(s.bundleNavItem, paneKey(selected) === "remoteImages" && s.bundleNavItemActive)}
              onClick={() => choose({ kind: "remoteImages" })}
            >
              <Icon name="image" className={s.navIcon} />
              <span className={s.navName}>Remote Images</span>
            </button>
            <button
              type="button"
              className={clsx(s.bundleNavItem, paneKey(selected) === "translation" && s.bundleNavItemActive)}
              onClick={() => choose({ kind: "translation" })}
            >
              <Icon name="translate" className={s.navIcon} />
              <span className={s.navName}>Translation</span>
            </button>

            <div className={s.sideSectionLabel}>Bundling</div>
            {BUNDLE_CATEGORIES.map((cat) => {
              const meta = CATEGORIES[cat];
              const selectedKey = paneKey(selected);
              const count = routeRules.filter((r) => r.target === cat).length;
              return (
                <button
                  key={cat}
                  type="button"
                  className={clsx(s.bundleNavItem, selectedKey === `builtin:${cat}` && s.bundleNavItemActive)}
                  onClick={() => choose({ kind: "builtin", id: cat })}
                >
                  <Icon name={meta.icon} className={s.navIcon} style={{ color: meta.color }} />
                  <span className={s.navName}>{meta.name}</span>
                  {count > 0 && <span className={s.navCount}>{count}</span>}
                </button>
              );
            })}

            <div className={s.sideSectionLabel}>Custom</div>
            {customBundles.map((bundle) => {
              const meta = getCategoryMeta(bundle.id, customBundles);
              return (
                <button
                  key={bundle.id}
                  type="button"
                  className={clsx(s.bundleNavItem, paneKey(selected) === `custom:${bundle.id}` && s.bundleNavItemActive)}
                  onClick={() => choose({ kind: "custom", id: bundle.id })}
                >
                  <Icon name={meta.icon} className={s.navIcon} style={{ color: meta.color }} />
                  <span className={s.navName}>{meta.name}</span>
                  <span className={s.navCount}>{routeRules.filter((r) => r.target === bundle.id).length}</span>
                </button>
              );
            })}
            <button
              type="button"
              className={clsx(s.newBundleBtn, selected.kind === "new" && s.bundleNavItemActive)}
              onClick={() => choose({ kind: "new" })}
            >
              <Icon name="add" className={s.navIcon} />
              New bundle
            </button>
          </aside>

          <main className={s.content}>
            {selected.kind === "general" ? (
              <GeneralSettings />
            ) : selected.kind === "remoteImages" ? (
              <RemoteImagesSettings />
            ) : selected.kind === "translation" ? (
              <TranslationSettings />
            ) : (
              <>
                {thread && (
                  <ThreadRouteSummary
                    thread={thread}
                    matches={threadMatches}
                    targetName={targetName}
                  />
                )}
                {selected.kind === "builtin" ? (
                  <BuiltinBundleEditor
                    category={selected.id}
                    ruleType={ruleType}
                    ruleValue={ruleValue}
                    thread={thread}
                    threadDefaults={threadRuleDefaults}
                    threadMatches={threadMatches}
                    highlightRuleId={highlightRuleId}
                    onRuleTypeChange={setThreadRule}
                    onRuleValueChange={setRuleValue}
                    onAddRule={addRule}
                    conflict={conflictNote}
                    saveHint="Rules are saved immediately."
                  />
                ) : (
                  <CustomBundleEditor
                    title={selected.kind === "new" ? "New custom bundle" : "Custom bundle"}
                    form={currentForm}
                    isNew={selected.kind === "new"}
                    thread={thread}
                    ruleType={ruleType}
                    ruleValue={ruleValue}
                    threadDefaults={threadRuleDefaults}
                    threadMatches={threadMatches}
                    highlightRuleId={highlightRuleId}
                    onFormChange={updateForm}
                    onRuleTypeChange={setThreadRule}
                    onRuleValueChange={setRuleValue}
                    onAddRule={addRule}
                    onRemoveDraftRule={removeDraftRule}
                    onSave={saveForm}
                    onDelete={selected.kind === "custom" ? removeCustom : undefined}
                    conflict={conflictNote}
                    saveHint={
                      selected.kind === "new"
                        ? "Rules will be created when you save the bundle."
                        : "Rules are saved immediately."
                    }
                  />
                )}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

const GeneralSettings = () => {
  const reclassify = useMailStore((st) => st.reclassify);
  const reclassifying = useMailStore((st) => st.reclassifying);
  const showDeleteActions = useShowDeleteActions();
  return (
    <div className={s.editor}>
      <div className={s.editorHeader}>
        <Icon name="settings" className={s.editorIcon} />
        <div>
          <h3 className={s.editorTitle}>General</h3>
          <p className={s.editorDesc}>Configure app-wide behavior.</p>
        </div>
      </div>
      <section className={s.section}>
        <h4 className={s.sectionTitle}>Actions</h4>
        <label className={s.policyChoice}>
          <input
            type="checkbox"
            checked={showDeleteActions}
            onChange={(e) => setShowDeleteActions(e.target.checked)}
            className={s.policyInput}
          />
          <span>Show delete actions in the mail stream</span>
        </label>
        <p className={s.helpText}>
          Adds Trash to row hover actions and “Delete all” sweeps to sections
          and bundles. Turn this off for the faithful Google Inbox experience —
          pin, snooze, and done only. Moving a single conversation to trash
          stays available inside the opened conversation either way.
        </p>
      </section>
      <section className={s.section}>
        <h4 className={s.sectionTitle}>Bundling</h4>
        <p className={s.helpText}>
          Rules are applied as mail arrives, so messages bundled before a rule
          change can be left in the wrong place. Re-run all rules and built-in
          detection across the inbox to fix them.
        </p>
        <button
          type="button"
          className={s.primaryBtn}
          disabled={reclassifying}
          onClick={() => reclassify()}
        >
          {reclassifying ? "Reclassifying…" : "Reclassify inbox"}
        </button>
      </section>
    </div>
  );
};

const sameTranslationConfig = (a: TranslationConfig, b: TranslationConfig): boolean =>
  a.provider === b.provider &&
  a.apiKey === b.apiKey &&
  a.endpoint === b.endpoint &&
  a.region === b.region &&
  a.model === b.model;

const TranslationSettings = () => {
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
    setTranslationConfig(normalized);
    setConfig(normalized);
    notify("Translation settings saved");
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
    <div className={s.editor}>
      <div className={s.editorHeader}>
        <Icon name="translate" className={s.editorIcon} />
        <div>
          <h3 className={s.editorTitle}>Translation</h3>
          <p className={s.editorDesc}>Translate messages to English on demand.</p>
        </div>
      </div>

      <section className={s.section}>
        <h4 className={s.sectionTitle}>Provider</h4>
        <label className={s.fieldBlock}>
          <span className={s.label}>Translation service</span>
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
        <p className={s.helpText}>
          Message text is sent only when you choose Translate to English.
        </p>
      </section>

      <section className={s.section}>
        <h4 className={s.sectionTitle}>Credentials</h4>
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
            Custom endpoints should accept JSON with text and targetLanguage, and return translatedText.
          </p>
        )}
        {config.provider === "openaiCompatible" && (
          <p className={s.helpText}>
            Start the LM Studio local server, then use its OpenAI-compatible chat completions endpoint.
          </p>
        )}
        {config.provider === "libretranslate" && (
          <p className={s.helpText}>
            LibreTranslate endpoints should accept q, source, target, format, and optionally api_key.
          </p>
        )}
      </section>

      <div className={s.actions}>
        <button type="button" className={s.deleteBtn} onClick={reset}>
          Reset
        </button>
        <button type="button" className={s.saveBtn} disabled={!hasChanges} onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
};

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const RemoteImagesSettings = () => {
  const notify = useMailStore((st) => st.notify);
  const [senders, setSenders] = useState(() => listTrustedImageSenders());
  const [policy, setPolicy] = useState<RemoteImagePolicy>(() => getRemoteImagePolicy());
  const [email, setEmail] = useState("");

  useEffect(
    () =>
      subscribeTrustedImageSenders(() => {
        setSenders(listTrustedImageSenders());
        setPolicy(getRemoteImagePolicy());
      }),
    [],
  );

  const normalizedEmail = normalizeEmail(email);
  const canAdd = policy === "senders" && normalizedEmail.includes("@");

  const addSender = () => {
    if (!canAdd) return;
    trustImageSender(normalizedEmail);
    setEmail("");
    notify(`Images allowed from ${normalizedEmail}`);
  };

  const removeSender = (sender: string) => {
    untrustImageSender(sender);
    notify(`Images blocked from ${sender}`);
  };

  const updatePolicy = (next: RemoteImagePolicy) => {
    setRemoteImagePolicy(next);
    setPolicy(next);
  };

  return (
    <div className={s.editor}>
      <div className={s.editorHeader}>
        <Icon name="image" className={s.editorIcon} />
        <div>
          <h3 className={s.editorTitle}>Remote Images</h3>
          <p className={s.editorDesc}>Control which senders can display remote images automatically.</p>
        </div>
      </div>

      <section className={s.section}>
        <h4 className={s.sectionTitle}>Display</h4>
        <div className={s.policyChoices}>
          <PolicyChoice
            checked={policy === "never"}
            label="Never show remote images"
            onChange={() => updatePolicy("never")}
          />
          <PolicyChoice
            checked={policy === "always"}
            label="Always show remote images"
            onChange={() => updatePolicy("always")}
          />
          <PolicyChoice
            checked={policy === "senders"}
            label="Only show from the following senders"
            onChange={() => updatePolicy("senders")}
          />
        </div>
      </section>

      <section className={clsx(s.section, policy !== "senders" && s.sectionDisabled)}>
        <div className={s.senderInputRow}>
          <input
            type="email"
            className={s.input}
            value={email}
            placeholder="sender@example.com"
            disabled={policy !== "senders"}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSender()}
          />
          <button type="button" className={s.primaryBtn} disabled={!canAdd} onClick={addSender}>
            Add sender
          </button>
        </div>
        {senders.length === 0 ? (
          <p className={s.emptyText}>No senders are allowed yet.</p>
        ) : (
          <div className={s.ruleList}>
            {senders.map((sender) => (
              <div className={s.senderRow} key={sender}>
                <span className={s.senderValue}>{sender}</span>
                <button
                  type="button"
                  className={s.ruleRemove}
                  onClick={() => removeSender(sender)}
                  title="Remove sender"
                >
                  <Icon name="delete" className={clsx(s.ruleRemoveIcon, s.ruleDeleteIcon)} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

const PolicyChoice = ({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) => (
  <label className={s.policyChoice}>
    <input
      type="radio"
      name="remote-image-policy"
      checked={checked}
      onChange={onChange}
      className={s.policyInput}
    />
    <span>{label}</span>
  </label>
);

const RuleComposer = ({
  ruleType,
  ruleValue,
  thread,
  threadDefaults,
  onRuleTypeChange,
  onRuleValueChange,
  onAddRule,
  conflict,
  saveHint,
}: {
  ruleType: RuleType;
  ruleValue: string;
  thread?: Thread;
  threadDefaults: Record<RuleType, string>;
  onRuleTypeChange: (type: RuleType) => void;
  onRuleValueChange: (value: string) => void;
  onAddRule: () => void;
  conflict?: string;
  saveHint: string;
}) => (
  <div className={s.ruleComposer}>
    {thread && (
      <div className={s.ruleChoices}>
        <RuleChoice active={ruleType === "domain"} disabled={!threadDefaults.domain} label="Sender domain" onClick={() => onRuleTypeChange("domain")} />
        <RuleChoice active={ruleType === "email"} disabled={!threadDefaults.email} label="Sender" onClick={() => onRuleTypeChange("email")} />
        <RuleChoice active={ruleType === "subject_keyword"} disabled={!threadDefaults.subject_keyword} label="Subject contains" onClick={() => onRuleTypeChange("subject_keyword")} />
      </div>
    )}
    <div className={s.ruleHelp}>
      <span>{rulePreview(ruleType, ruleValue)}</span>
      <span>{saveHint}</span>
    </div>
    {conflict && (
      <div className={s.ruleConflict}>
        <Icon name="info" className={s.ruleConflictIcon} />
        <span>{conflict}</span>
      </div>
    )}
    <div className={s.ruleInputRow}>
      {!thread && (
        <select
          value={ruleType}
          onChange={(e) => onRuleTypeChange(e.target.value as RuleType)}
          className={s.select}
        >
          <option value="domain">Domain</option>
          <option value="email">Email address</option>
          <option value="subject_keyword">Subject contains</option>
        </select>
      )}
      <input
        type="text"
        className={s.input}
        value={ruleValue}
        placeholder={ruleType === "domain" ? "example.com" : ruleType === "email" ? "user@example.com" : "invoice"}
        onChange={(e) => onRuleValueChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onAddRule()}
      />
      <button type="button" className={s.primaryBtn} disabled={!normalizeRuleValue(ruleType, ruleValue)} onClick={onAddRule}>
        Add rule
      </button>
    </div>
  </div>
);

const PRECEDENCE_NOTE =
  "When rules overlap, the most specific wins: exact sender, then sender domain, then subject.";

const ThreadRouteSummary = ({
  thread,
  matches,
  targetName,
}: {
  thread: Thread;
  matches: readonly RouteRuleRecord[];
  targetName: (target: Category) => string;
}) => {
  const reclassify = useMailStore((st) => st.reclassify);
  const reclassifying = useMailStore((st) => st.reclassifying);
  // The thread prop is a snapshot; read the category live so the banner
  // settles once a reclassify lands.
  const liveCategory = useMailStore((st) => {
    for (const m of thread.messages) {
      const live = st.messagesById[m.id];
      if (live) return live.category;
    }
    return thread.category;
  });

  const winner = matches[0];
  const expected = winner && winner.target !== "personal" ? winner.target : null;
  const stale = winner !== undefined && liveCategory !== expected;

  const precedence =
    matches.length > 1
      ? ` ${matches.length} rules match this thread — the most specific one wins.`
      : "";
  const text = winner
    ? stale
      ? `Your ${ruleTypeLabel[winner.type].toLowerCase()} rule “${winner.value}” routes mail like this to ${targetName(winner.target)}, but this thread was bundled before the rule and hasn't moved.${precedence}`
      : `Your ${ruleTypeLabel[winner.type].toLowerCase()} rule “${winner.value}” routes this thread to ${targetName(winner.target)}.${precedence}`
    : liveCategory
      ? `This thread is in ${targetName(liveCategory)} because it matches the built-in detection. Rules you add always override built-in detection.`
      : "No rules match this thread, so it stays in the inbox.";
  return (
    <div className={s.threadSummary}>
      <Icon name="alt_route" className={s.threadSummaryIcon} />
      <span>{text}</span>
      {stale && (
        <button
          type="button"
          className={s.threadSummaryAction}
          disabled={reclassifying}
          onClick={() => reclassify(thread.messages.map((m) => m.id))}
        >
          {reclassifying ? "Applying…" : "Apply now"}
        </button>
      )}
    </div>
  );
};

const BuiltinBundleEditor = ({
  category,
  ruleType,
  ruleValue,
  thread,
  threadDefaults,
  threadMatches,
  highlightRuleId,
  onRuleTypeChange,
  onRuleValueChange,
  onAddRule,
  conflict,
  saveHint,
}: {
  category: BuiltinCategory;
  ruleType: RuleType;
  ruleValue: string;
  thread?: Thread;
  threadDefaults: Record<RuleType, string>;
  threadMatches: readonly RouteRuleRecord[];
  highlightRuleId?: string;
  onRuleTypeChange: (type: RuleType) => void;
  onRuleValueChange: (value: string) => void;
  onAddRule: () => void;
  conflict?: string;
  saveHint: string;
}) => {
  const meta = CATEGORIES[category];
  const routeRules = useRouteRules();
  const deleteRouteRule = useMailStore((st) => st.deleteRouteRule);
  const rules = routeRules.filter((r) => r.target === category);

  return (
    <div className={s.editor}>
      <div className={s.editorHeader}>
        <Icon name={meta.icon} className={s.editorIcon} style={{ color: meta.color }} />
        <div>
          <h3 className={s.editorTitle}>{meta.name}</h3>
          <p className={s.editorDesc}>
            {category === "personal"
              ? `Rules here keep matching messages in the main inbox, unbundled. ${PRECEDENCE_NOTE}`
              : `Rules here route matching messages into this bundle. ${PRECEDENCE_NOTE}`}
          </p>
        </div>
      </div>

      <section className={s.section}>
        <h4 className={s.sectionTitle}>Rules</h4>
        {rules.length === 0 ? (
          <p className={s.emptyText}>
            {category === "personal"
              ? "No custom rules yet."
              : `No custom rules yet — messages land here when they match the built-in ${meta.name} detection.`}
          </p>
        ) : (
          <div className={s.ruleList}>
            {rules.map((row) => (
              <RuleRow
                key={row.id}
                rule={row}
                badge={threadBadge(threadMatches, row.id)}
                highlighted={row.id === highlightRuleId}
                onRemove={() => deleteRouteRule(row.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section className={s.section}>
        <h4 className={s.sectionTitle}>{thread ? "Add from thread" : "Add rule"}</h4>
        <RuleComposer
          ruleType={ruleType}
          ruleValue={ruleValue}
          thread={thread}
          threadDefaults={threadDefaults}
          onRuleTypeChange={onRuleTypeChange}
          onRuleValueChange={onRuleValueChange}
          onAddRule={onAddRule}
          conflict={conflict}
          saveHint={saveHint}
        />
      </section>
    </div>
  );
};

const CustomBundleEditor = ({
  title,
  form,
  isNew,
  thread,
  ruleType,
  ruleValue,
  threadDefaults,
  threadMatches,
  highlightRuleId,
  onFormChange,
  onRuleTypeChange,
  onRuleValueChange,
  onAddRule,
  onRemoveDraftRule,
  onSave,
  onDelete,
  conflict,
  saveHint,
}: {
  title: string;
  form: BundleFormState;
  isNew: boolean;
  thread?: Thread;
  ruleType: RuleType;
  ruleValue: string;
  threadDefaults: Record<RuleType, string>;
  threadMatches: readonly RouteRuleRecord[];
  highlightRuleId?: string;
  onFormChange: (patch: Partial<BundleFormState>) => void;
  onRuleTypeChange: (type: RuleType) => void;
  onRuleValueChange: (value: string) => void;
  onAddRule: () => void;
  onRemoveDraftRule: (idx: number) => void;
  onSave: () => void;
  onDelete?: () => void;
  conflict?: string;
  saveHint: string;
}) => {
  const routeRules = useRouteRules();
  const deleteRouteRule = useMailStore((st) => st.deleteRouteRule);
  const savedRules = routeRules.filter((r) => r.target === form.id);
  const [iconQuery, setIconQuery] = useState("");
  const normalizedIconQuery = iconQuery.trim().toLowerCase();
  const iconGroups = useMemo(() => {
    const groups = CUSTOM_BUNDLE_ICON_GROUPS.map((group) => ({
      ...group,
      icons: group.icons.filter((icon) => {
        if (!normalizedIconQuery) return true;
        const searchable = `${group.label} ${icon.replaceAll("_", " ")}`.toLowerCase();
        return searchable.includes(normalizedIconQuery);
      }),
    })).filter((group) => group.icons.length > 0);

    if (!CUSTOM_BUNDLE_ICONS.includes(form.icon) && form.icon.includes(normalizedIconQuery)) {
      return [{ label: "Selected", icons: [form.icon] }, ...groups];
    }
    return groups;
  }, [form.icon, normalizedIconQuery]);

  return (
    <div className={s.editor}>
      <div className={s.editorHeader}>
        <Icon name={form.icon} className={s.editorIcon} style={{ color: form.color }} />
        <div>
          <h3 className={s.editorTitle}>{title}</h3>
          <p className={s.editorDesc}>{PRECEDENCE_NOTE}</p>
        </div>
      </div>

      <section className={s.section}>
        <label className={s.label}>Bundle name</label>
        <input
          type="text"
          className={s.input}
          value={form.name}
          placeholder="My Bundle"
          onChange={(e) => onFormChange({ name: e.target.value })}
        />
      </section>

      <section className={s.twoColumn}>
        <div>
          <label className={s.label}>Color</label>
          <div className={s.colorGrid}>
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={clsx(s.colorSwatch, form.color === color && s.colorSwatchActive)}
                style={{ backgroundColor: color }}
                onClick={() => onFormChange({ color })}
                title={color}
              />
            ))}
          </div>
        </div>
        <div>
          <label className={s.label}>Icon</label>
          <input
            type="search"
            className={clsx(s.input, s.iconSearch)}
            value={iconQuery}
            placeholder="Search icons"
            onChange={(e) => setIconQuery(e.target.value)}
          />
          <div className={s.iconPicker}>
            {iconGroups.length === 0 ? (
              <p className={s.emptyText}>No matching icons.</p>
            ) : (
              iconGroups.map((group) => (
                <div key={group.label} className={s.iconGroup}>
                  <div className={s.iconGroupLabel}>{group.label}</div>
                  <div className={s.iconGrid}>
                    {group.icons.map((icon) => (
                      <button
                        key={icon}
                        type="button"
                        className={clsx(s.iconOption, form.icon === icon && s.iconOptionActive)}
                        onClick={() => onFormChange({ icon })}
                        title={icon}
                        aria-label={`Use ${icon.replaceAll("_", " ")} icon`}
                      >
                        <Icon name={icon} className={s.iconOptionIcon} style={{ color: form.icon === icon ? form.color : undefined }} />
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className={s.section}>
        <h4 className={s.sectionTitle}>Rules</h4>
        {isNew ? (
          form.draftRules.length === 0 ? (
            <p className={s.emptyText}>No rules yet.</p>
          ) : (
            <div className={s.ruleList}>
              {form.draftRules.map((rule, idx) => (
                <RuleRow key={`${rule.type}:${rule.value}`} rule={rule} onRemove={() => onRemoveDraftRule(idx)} />
              ))}
            </div>
          )
        ) : savedRules.length === 0 ? (
          <p className={s.emptyText}>No rules yet.</p>
        ) : (
          <div className={s.ruleList}>
            {savedRules.map((row) => (
              <RuleRow
                key={row.id}
                rule={row}
                badge={threadBadge(threadMatches, row.id)}
                highlighted={row.id === highlightRuleId}
                onRemove={() => deleteRouteRule(row.id)}
              />
            ))}
          </div>
        )}
        <RuleComposer
          ruleType={ruleType}
          ruleValue={ruleValue}
          thread={thread}
          threadDefaults={threadDefaults}
          onRuleTypeChange={onRuleTypeChange}
          onRuleValueChange={onRuleValueChange}
          onAddRule={onAddRule}
          conflict={conflict}
          saveHint={saveHint}
        />
      </section>

      <div className={s.actions}>
        {onDelete && (
          <button type="button" className={s.deleteBtn} onClick={onDelete}>
            Delete
          </button>
        )}
        <button type="button" className={s.saveBtn} disabled={!form.name.trim()} onClick={onSave}>
          Save bundle
        </button>
      </div>
    </div>
  );
};

const RuleRow = ({
  rule,
  onRemove,
  badge,
  highlighted,
}: {
  rule: DraftRule;
  onRemove: () => void;
  badge?: RuleBadge;
  highlighted?: boolean;
}) => {
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView({ block: "center" });
  }, [highlighted]);
  return (
    <div ref={rowRef} className={clsx(s.ruleRow, highlighted && s.ruleRowHighlight)}>
      <span className={s.ruleType}>{ruleTypeLabel[rule.type]}</span>
      <span className={s.ruleValue}>{rule.value}</span>
      {badge === "wins" && (
        <span
          className={clsx(s.ruleBadge, s.ruleBadgeWins)}
          title="Of the rules matching the open thread, this is the most specific — it decides where the thread goes."
        >
          Matches this thread
        </span>
      )}
      {badge === "outranked" && (
        <span
          className={clsx(s.ruleBadge, s.ruleBadgeOutranked)}
          title="This rule also matches the open thread, but a more specific rule wins: exact sender beats domain beats subject."
        >
          Outranked
        </span>
      )}
      <button type="button" className={s.ruleRemove} onClick={onRemove} title="Remove rule">
        <Icon name="delete" className={clsx(s.ruleRemoveIcon, s.ruleDeleteIcon)} />
      </button>
    </div>
  );
};

const RuleChoice = ({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    className={active ? s.ruleChoiceActive : s.ruleChoice}
    disabled={disabled}
    onClick={onClick}
  >
    {label}
  </button>
);

import { clsx } from "clsx";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CATEGORIES, getCategoryMeta } from "../../shared/categories";
import { parseSender } from "../../shared/senders";
import type { BuiltinCategory, Category, CustomBundleRule, Thread } from "../../shared/types";
import { useBundleRules, useCustomBundles, useMailStore, useOverrides } from "../../store/mailStore";
import { Icon } from "./Icon";
import s from "./BundleManagerModal.module.css";

type RuleType = CustomBundleRule["type"];
type SelectedBundle = { kind: "builtin"; id: BuiltinCategory } | { kind: "custom"; id: string } | { kind: "new" };

interface BundleFormState {
  id: string;
  name: string;
  color: string;
  icon: string;
  rules: CustomBundleRule[];
  order: number;
}

const BUNDLE_CATEGORIES = Object.entries(CATEGORIES)
  .filter(([cat]) => cat !== "personal")
  .sort(([, a], [, b]) => a.order - b.order)
  .map(([cat]) => cat as BuiltinCategory);

const PRESET_COLORS = [
  "#4285F4", "#34A853", "#FBBC04", "#EA4335",
  "#FF6D01", "#9C27B0", "#00BCD4", "#795548",
  "#607D8B", "#E91E63", "#009688", "#673AB7",
];

const CUSTOM_BUNDLE_ICONS = [
  "label", "label_important", "local_offer", "bookmark", "star", "favorite",
  "inbox", "mail", "drafts", "mark_email_unread", "notifications", "campaign",
  "work", "business", "badge", "assignment", "task_alt", "event", "schedule",
  "account_balance", "credit_card", "savings", "receipt", "payments", "trending_up",
  "shopping_bag", "shopping_cart", "storefront", "redeem", "sell", "inventory_2",
  "flight", "hotel", "luggage", "map", "directions_car", "train",
  "group", "person", "contacts", "forum", "chat", "alternate_email",
  "school", "local_library", "menu_book", "science", "psychology", "lightbulb",
  "restaurant", "local_cafe", "cake", "fitness_center", "health_and_safety", "spa",
  "music_note", "movie", "photo_camera", "sports_esports", "sports_soccer", "pets",
  "home", "build", "key", "security", "cloud", "folder",
];

const ruleTypeLabel: Record<RuleType, string> = {
  domain: "Domain",
  email: "Email",
  subject_keyword: "Subject contains",
};

const normalizeRule = (type: RuleType, value: string): string => {
  let trimmed = value.trim().toLowerCase();
  if (type === "subject_keyword") {
    trimmed = trimmed
      .replace(/^\/\.\*/, "")
      .replace(/\.\*\/$/, "")
      .replace(/^\.\*/, "")
      .replace(/\.\*$/, "")
      .trim();
  }
  if (type === "domain") return trimmed.replace(/^@/, "");
  return trimmed;
};

const ruleDescription = (type: RuleType): string => {
  if (type === "domain") return "Matches any sender at this domain.";
  if (type === "email") return "Matches this exact sender address.";
  return "Matches when the subject includes this text anywhere.";
};

const rulePreview = (type: RuleType, value: string): string => {
  const normalized = normalizeRule(type, value);
  if (!normalized) return ruleDescription(type);
  if (type === "domain") return `Sender domain is ${normalized}`;
  if (type === "email") return `Sender is ${normalized}`;
  return `Subject contains "${normalized}"`;
};

const emptyForm = (order: number, seedRule?: CustomBundleRule): BundleFormState => ({
  id: crypto.randomUUID(),
  name: "",
  color: PRESET_COLORS[0]!,
  icon: "label",
  rules: seedRule ? [seedRule] : [],
  order,
});

const bundleKey = (selected: SelectedBundle): string =>
  selected.kind === "new" ? "new" : `${selected.kind}:${selected.id}`;

const hasRule = (rules: readonly CustomBundleRule[], rule: CustomBundleRule): boolean =>
  rules.some((r) => r.type === rule.type && r.value.toLowerCase() === rule.value.toLowerCase());

export const BundleManagerModal = ({
  onClose,
  thread,
  initialCategory,
}: {
  onClose: () => void;
  thread?: Thread;
  initialCategory?: Category | null;
}) => {
  const customBundles = useCustomBundles();
  const bundleRules = useBundleRules();
  const overrides = useOverrides();
  const setOverride = useMailStore((st) => st.setOverride);
  const setBundleRule = useMailStore((st) => st.setBundleRule);
  const setCustomBundle = useMailStore((st) => st.setCustomBundle);
  const deleteCustomBundle = useMailStore((st) => st.deleteCustomBundle);
  const notify = useMailStore((st) => st.notify);

  const sender = useMemo(
    () => parseSender(thread?.messages[0]?.author ?? ""),
    [thread],
  );
  const threadRuleDefaults: Record<RuleType, string> = {
    domain: sender.domain,
    email: sender.email,
    subject_keyword: thread?.subject ?? "",
  };
  const initialRuleType: RuleType = sender.domain ? "domain" : sender.email ? "email" : "subject_keyword";
  const initialRuleValue = thread ? normalizeRule(initialRuleType, threadRuleDefaults[initialRuleType]) : "";
  const seededRule = initialRuleValue ? { type: initialRuleType, value: initialRuleValue } : undefined;

  const initialSelected = (): SelectedBundle => {
    if (initialCategory && BUNDLE_CATEGORIES.includes(initialCategory as BuiltinCategory)) {
      return { kind: "builtin", id: initialCategory as BuiltinCategory };
    }
    if (initialCategory && customBundles.some((b) => b.id === initialCategory)) {
      return { kind: "custom", id: initialCategory };
    }
    return { kind: "builtin", id: "updates" };
  };

  const selectedAtOpen = initialSelected();
  const initialForm = (): BundleFormState => {
    if (selectedAtOpen.kind === "custom") {
      const bundle = customBundles.find((b) => b.id === selectedAtOpen.id);
      if (bundle) {
        return {
          id: bundle.id,
          name: bundle.name,
          color: bundle.color,
          icon: bundle.icon,
          rules: bundle.rules,
          order: bundle.order,
        };
      }
    }
    return emptyForm(10 + customBundles.length, selectedAtOpen.kind === "new" ? seededRule : undefined);
  };

  const [selected, setSelected] = useState<SelectedBundle>(selectedAtOpen);
  const [form, setForm] = useState<BundleFormState>(initialForm);
  const [ruleType, setRuleType] = useState<RuleType>(initialRuleType);
  const [ruleValue, setRuleValue] = useState(initialRuleValue);

  const selectedCustom = selected.kind === "custom"
    ? customBundles.find((b) => b.id === selected.id) ?? null
    : null;
  const currentForm = form;

  const choose = (next: SelectedBundle) => {
    setSelected(next);
    if (next.kind === "custom") {
      const bundle = customBundles.find((b) => b.id === next.id);
      if (bundle) {
        setForm({
          id: bundle.id,
          name: bundle.name,
          color: bundle.color,
          icon: bundle.icon,
          rules: bundle.rules,
          order: bundle.order,
        });
      }
    } else if (next.kind === "new") {
      const activeRuleValue = normalizeRule(ruleType, ruleValue);
      const activeRule = activeRuleValue ? { type: ruleType, value: activeRuleValue } : seededRule;
      setForm(emptyForm(10 + customBundles.length, activeRule));
    }
  };

  const saveForm = () => {
    const name = currentForm.name.trim();
    if (!name) return;
    setCustomBundle({ ...currentForm, name });
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

  const addCustomRule = (rule: CustomBundleRule) => {
    if (hasRule(currentForm.rules, rule)) {
      notify(`${currentForm.name || "This bundle"} already has that rule`);
      return;
    }
    setForm((prev) => ({ ...prev, rules: [...prev.rules, rule] }));
  };

  const removeCustomRule = (idx: number) => {
    setForm((prev) => ({ ...prev, rules: prev.rules.filter((_, i) => i !== idx) }));
  };

  const addBuiltinRule = (category: BuiltinCategory, rule: CustomBundleRule) => {
    const meta = CATEGORIES[category];
    if (rule.type === "domain") {
      const existing = overrides.find((o) => o.senderDomain === rule.value);
      if (existing?.category === category) {
        notify(`${rule.value} is already routed to ${meta.name}`);
        return;
      }
      setOverride(rule.value, category);
      notify(`Rule added to ${meta.name}`);
      return;
    }

    const exists = bundleRules.some(
      (row) =>
        row.category === category &&
        row.rule.type === rule.type &&
        row.rule.value.toLowerCase() === rule.value,
    );
    if (exists) {
      notify(`${meta.name} already has that rule`);
      return;
    }
    setBundleRule({ id: crypto.randomUUID(), category, rule, createdAt: Date.now() });
    notify(`Rule added to ${meta.name}`);
  };

  const addRule = () => {
    const value = normalizeRule(ruleType, ruleValue);
    if (!value) return;
    const rule = { type: ruleType, value };
    if (selected.kind === "builtin") addBuiltinRule(selected.id, rule);
    else addCustomRule(rule);
    setRuleValue(thread ? normalizeRule(ruleType, threadRuleDefaults[ruleType]) : "");
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
            <h2 className={s.title}>Bundle manager</h2>
            {thread && <p className={s.subtitle}>Add rules from this thread or manage any bundle.</p>}
          </div>
          <button type="button" className={s.closeBtn} onClick={onClose} aria-label="Close">
            <Icon name="close" className={s.closeIcon} />
          </button>
        </div>

        <div className={s.body}>
          <aside className={s.sidebar}>
            <div className={s.sideSectionLabel}>Built-in</div>
            {BUNDLE_CATEGORIES.map((cat) => {
              const meta = CATEGORIES[cat];
              const selectedKey = bundleKey(selected);
              const count = overrides.filter((o) => o.category === cat).length +
                bundleRules.filter((r) => r.category === cat).length;
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
                  className={clsx(s.bundleNavItem, bundleKey(selected) === `custom:${bundle.id}` && s.bundleNavItemActive)}
                  onClick={() => choose({ kind: "custom", id: bundle.id })}
                >
                  <Icon name={meta.icon} className={s.navIcon} style={{ color: meta.color }} />
                  <span className={s.navName}>{meta.name}</span>
                  <span className={s.navCount}>{bundle.rules.length}</span>
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
            {selected.kind === "builtin" ? (
              <BuiltinBundleEditor
                category={selected.id}
                ruleType={ruleType}
                ruleValue={ruleValue}
                thread={thread}
                threadDefaults={threadRuleDefaults}
                onRuleTypeChange={setThreadRule}
                onRuleValueChange={setRuleValue}
                onAddRule={addRule}
                saveHint="Built-in bundle rules are saved immediately."
              />
            ) : (
              <CustomBundleEditor
                title={selected.kind === "new" ? "New custom bundle" : "Custom bundle"}
                form={currentForm}
                thread={thread}
                ruleType={ruleType}
                ruleValue={ruleValue}
                threadDefaults={threadRuleDefaults}
                onFormChange={updateForm}
                onRuleTypeChange={setThreadRule}
                onRuleValueChange={setRuleValue}
                onAddRule={addRule}
                onRemoveRule={removeCustomRule}
                onSave={saveForm}
                onDelete={selected.kind === "custom" ? removeCustom : undefined}
                saveHint="Custom bundle rules are added to this draft. Save the bundle to apply them."
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

const RuleComposer = ({
  ruleType,
  ruleValue,
  thread,
  threadDefaults,
  onRuleTypeChange,
  onRuleValueChange,
  onAddRule,
  saveHint,
}: {
  ruleType: RuleType;
  ruleValue: string;
  thread?: Thread;
  threadDefaults: Record<RuleType, string>;
  onRuleTypeChange: (type: RuleType) => void;
  onRuleValueChange: (value: string) => void;
  onAddRule: () => void;
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
      <button type="button" className={s.primaryBtn} disabled={!normalizeRule(ruleType, ruleValue)} onClick={onAddRule}>
        Add rule
      </button>
    </div>
  </div>
);

const BuiltinBundleEditor = ({
  category,
  ruleType,
  ruleValue,
  thread,
  threadDefaults,
  onRuleTypeChange,
  onRuleValueChange,
  onAddRule,
  saveHint,
}: {
  category: BuiltinCategory;
  ruleType: RuleType;
  ruleValue: string;
  thread?: Thread;
  threadDefaults: Record<RuleType, string>;
  onRuleTypeChange: (type: RuleType) => void;
  onRuleValueChange: (value: string) => void;
  onAddRule: () => void;
  saveHint: string;
}) => {
  const meta = CATEGORIES[category];
  const overrides = useOverrides();
  const bundleRules = useBundleRules();
  const setOverride = useMailStore((st) => st.setOverride);
  const deleteBundleRule = useMailStore((st) => st.deleteBundleRule);
  const domains = overrides.filter((o) => o.category === category).map((o) => o.senderDomain);
  const rules = bundleRules.filter((r) => r.category === category);

  return (
    <div className={s.editor}>
      <div className={s.editorHeader}>
        <Icon name={meta.icon} className={s.editorIcon} style={{ color: meta.color }} />
        <div>
          <h3 className={s.editorTitle}>{meta.name}</h3>
          <p className={s.editorDesc}>Rules here always route matching messages into this built-in bundle.</p>
        </div>
      </div>

      <section className={s.section}>
        <h4 className={s.sectionTitle}>Rules</h4>
        {domains.length === 0 && rules.length === 0 ? (
          <p className={s.emptyText}>No custom rules yet.</p>
        ) : (
          <div className={s.ruleList}>
            {domains.map((domain) => (
              <RuleRow key={`domain:${domain}`} rule={{ type: "domain", value: domain }} onRemove={() => setOverride(domain, null)} />
            ))}
            {rules.map((row) => (
              <RuleRow key={row.id} rule={row.rule} onRemove={() => deleteBundleRule(row.id)} />
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
          saveHint={saveHint}
        />
      </section>
    </div>
  );
};

const CustomBundleEditor = ({
  title,
  form,
  thread,
  ruleType,
  ruleValue,
  threadDefaults,
  onFormChange,
  onRuleTypeChange,
  onRuleValueChange,
  onAddRule,
  onRemoveRule,
  onSave,
  onDelete,
  saveHint,
}: {
  title: string;
  form: BundleFormState;
  thread?: Thread;
  ruleType: RuleType;
  ruleValue: string;
  threadDefaults: Record<RuleType, string>;
  onFormChange: (patch: Partial<BundleFormState>) => void;
  onRuleTypeChange: (type: RuleType) => void;
  onRuleValueChange: (value: string) => void;
  onAddRule: () => void;
  onRemoveRule: (idx: number) => void;
  onSave: () => void;
  onDelete?: () => void;
  saveHint: string;
}) => (
  <div className={s.editor}>
    <div className={s.editorHeader}>
      <Icon name={form.icon} className={s.editorIcon} style={{ color: form.color }} />
      <div>
        <h3 className={s.editorTitle}>{title}</h3>
        <p className={s.editorDesc}>Custom bundle rules are checked before built-in bundle rules.</p>
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
        <div className={s.iconGrid}>
          {CUSTOM_BUNDLE_ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              className={clsx(s.iconOption, form.icon === icon && s.iconOptionActive)}
              onClick={() => onFormChange({ icon })}
              title={icon}
            >
              <Icon name={icon} className={s.iconOptionIcon} style={{ color: form.icon === icon ? form.color : undefined }} />
            </button>
          ))}
        </div>
      </div>
    </section>

    <section className={s.section}>
      <h4 className={s.sectionTitle}>Rules</h4>
      {form.rules.length === 0 ? (
        <p className={s.emptyText}>No rules yet.</p>
      ) : (
        <div className={s.ruleList}>
          {form.rules.map((rule, idx) => (
            <RuleRow key={`${rule.type}:${rule.value}:${idx}`} rule={rule} onRemove={() => onRemoveRule(idx)} />
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

const RuleRow = ({ rule, onRemove }: { rule: CustomBundleRule; onRemove: () => void }) => (
  <div className={s.ruleRow}>
    <span className={s.ruleType}>{ruleTypeLabel[rule.type]}</span>
    <span className={s.ruleValue}>{rule.value}</span>
    <button type="button" className={s.ruleRemove} onClick={onRemove} title="Remove rule">
      <Icon name="close" className={s.ruleRemoveIcon} />
    </button>
  </div>
);

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

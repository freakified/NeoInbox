import { clsx } from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES } from "../../../shared/categories";
import { normalizeRuleValue, ruleTypeLabel } from "../../../shared/routeRules";
import type { BuiltinCategory, Category, RouteRuleRecord, Thread } from "../../../shared/types";
import { useMailStore, useRouteRules } from "../../../store/mailStore";
import { Icon } from "../Icon";
import s from "../BundleManagerModal.module.css";
import {
  type RuleType,
  type DraftRule,
  type BundleFormState,
  PRESET_COLORS,
  CUSTOM_BUNDLE_ICON_GROUPS,
  CUSTOM_BUNDLE_ICONS,
  EXCLUSIONS,
  rulePreview,
  type RuleBadge,
  threadBadge,
} from "./bundleForm";

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
  saveHint?: string;
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
      {saveHint && <span>{saveHint}</span>}
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

const PRECEDENCE_NOTE = "Most specific rule wins: sender, then domain, then subject.";

export const ThreadRouteSummary = ({
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
      const live = st.messagesByKey[m.key];
      if (live) return live.category;
    }
    return thread.category;
  });

  const winner = matches[0];
  const expected = winner && winner.target !== "personal" ? winner.target : null;
  const stale = winner !== undefined && liveCategory !== expected;
  // Only claim the thread predates the rule when the timestamps actually say
  // so; otherwise the rule existed when this mail arrived and classification
  // simply hasn't caught up (or missed), which "Apply now" fixes either way.
  const newestMessageDate = Math.max(0, ...thread.messages.map((m) => m.date));
  const predatesRule = winner !== undefined && newestMessageDate < winner.createdAt;

  const precedence =
    matches.length > 1
      ? ` ${matches.length} rules match; the most specific wins.`
      : "";
  const text = winner
    ? stale
      ? predatesRule
        ? `Rule “${winner.value}” routes this to ${targetName(winner.target)}, but the thread predates it.${precedence}`
        : `Rule “${winner.value}” routes this to ${targetName(winner.target)}, but hasn't been applied yet.${precedence}`
      : `Rule “${winner.value}” routes this to ${targetName(winner.target)}.${precedence}`
    : liveCategory
      ? `Built-in detection put this in ${targetName(liveCategory)}. Rules override it.`
      : "No rules match this thread.";
  return (
    <div className={s.threadSummary}>
      <Icon name="alt_route" className={s.threadSummaryIcon} />
      <span>{text}</span>
      {stale && (
        <button
          type="button"
          className={s.threadSummaryAction}
          disabled={reclassifying}
          onClick={() => reclassify(thread.messages.map((m) => m.key))}
        >
          {reclassifying ? "Applying…" : "Apply now"}
        </button>
      )}
    </div>
  );
};

export const BuiltinBundleEditor = ({
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
  saveHint?: string;
}) => {
  const meta = category === "personal" ? { ...CATEGORIES.personal, ...EXCLUSIONS } : CATEGORIES[category];
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
              ? `Matching mail is never bundled. ${PRECEDENCE_NOTE}`
              : `Matching mail goes here. ${PRECEDENCE_NOTE}`}
          </p>
        </div>
      </div>

      <section className={s.section}>
        <h4 className={s.sectionTitle}>Rules</h4>
        {rules.length === 0 ? (
          <p className={s.emptyText}>
            {category === "personal" ? "No rules yet." : "No rules yet; built-in detection still applies."}
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

export const CustomBundleEditor = ({
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
  saveHint?: string;
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

      <div className={s.formActions}>
        <button type="button" className={s.saveBtn} disabled={!form.name.trim()} onClick={onSave}>
          Save bundle
        </button>
        {onDelete && (
          <button type="button" className={s.deleteBtn} onClick={onDelete}>
            Delete
          </button>
        )}
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
          title="Most specific match; decides where this thread goes."
        >
          Matches this thread
        </span>
      )}
      {badge === "outranked" && (
        <span
          className={clsx(s.ruleBadge, s.ruleBadgeOutranked)}
          title="Also matches, but a more specific rule wins."
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

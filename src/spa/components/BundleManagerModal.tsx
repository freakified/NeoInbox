import { clsx } from "clsx";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CATEGORIES, getCategoryMeta } from "../../shared/categories";
import { findRouteRule, matchingRouteRules, normalizeRuleValue } from "../../shared/routeRules";
import { suggestRuleType } from "../../shared/ruleSuggestion";
import { parseSender } from "../../shared/senders";
import type { BuiltinCategory, Category, Thread } from "../../shared/types";
import { useCustomBundles, useMailStore, useRouteRules } from "../../store/mailStore";
import { Icon } from "./Icon";
import s from "./BundleManagerModal.module.css";
import {
  type RuleType,
  type SelectedBundle,
  type SelectedPane,
  type BundleFormState,
  BUNDLE_CATEGORIES,
  emptyForm,
  paneKey,
  hasDraftRule,
} from "./settings/bundleForm";
import { GeneralSettings } from "./settings/GeneralSettings";
import { TripSettings } from "./settings/TripSettings";
import { TranslationSettings } from "./settings/TranslationSettings";
import { RemoteImagesSettings } from "./settings/RemoteImagesSettings";
import { BuiltinBundleEditor, CustomBundleEditor, ThreadRouteSummary } from "./settings/BundleEditors";

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
  const initialRuleType: RuleType = sender.domain
    ? suggestRuleType(sender.domain)
    : sender.email
      ? "email"
      : "subject_keyword";
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
              className={clsx(s.bundleNavItem, paneKey(selected) === "trips" && s.bundleNavItemActive)}
              onClick={() => choose({ kind: "trips" })}
            >
              <Icon name="travel" className={s.navIcon} />
              <span className={s.navName}>Trips</span>
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
            ) : selected.kind === "trips" ? (
              <TripSettings />
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

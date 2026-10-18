import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getCategoryMeta } from "../../shared/categories";
import {
  findRouteRule,
  matchingRouteRules,
  normalizeRuleValue,
  ruleMatchesMessage,
  ruleTypeLabel,
} from "../../shared/routeRules";
import { isSharedMailboxDomain, suggestRuleType } from "../../shared/ruleSuggestion";
import type { ParsedSender } from "../../shared/senders";
import type { Category, RouteRuleRecord, RouteRuleType, Thread } from "../../shared/types";
import { useCustomBundles, useMailStore, useRouteRules } from "../../store/mailStore";
import { Icon } from "./Icon";
import s from "./MoveRuleDialog.module.css";

export interface MoveRuleDialogProps {
  target: Category;
  thread: Thread;
  sender: ParsedSender;
  onCancel: () => void;
  onConfirm: (type: RouteRuleType, value: string) => void;
}

const messageLabel = (count: number): string => (count === 1 ? "1 message" : `${count} messages`);

/** A rule record shape good enough for matchingRouteRules; never persisted. */
const PREVIEW_ID = "__move-rule-preview__";

export const MoveRuleDialog = ({ target, thread, sender, onCancel, onConfirm }: MoveRuleDialogProps) => {
  const routeRules = useRouteRules();
  const customBundles = useCustomBundles();
  const messages = useMailStore((st) => st.messagesByKey);

  const initialType: RouteRuleType = sender.domain
    ? suggestRuleType(sender.domain)
    : sender.email
      ? "email"
      : "subject_keyword";

  const [ruleType, setRuleType] = useState<RouteRuleType>(initialType);
  const [subjectValue, setSubjectValue] = useState(thread.subject);

  const rawValueFor = (type: RouteRuleType): string =>
    type === "domain" ? sender.domain : type === "email" ? sender.email : subjectValue;

  const value = normalizeRuleValue(ruleType, rawValueFor(ruleType));
  const targetName = getCategoryMeta(target, customBundles).name;

  const allMessages = useMemo(() => Object.values(messages), [messages]);
  const countFor = (type: RouteRuleType, raw: string): number => {
    const v = normalizeRuleValue(type, raw);
    if (!v) return 0;
    return allMessages.filter((m) => ruleMatchesMessage({ type, value: v }, m)).length;
  };

  const previousAtKey = value ? findRouteRule(routeRules, ruleType, value) : undefined;

  const previewMatches: RouteRuleRecord[] = useMemo(() => {
    if (!value) return [];
    const preview: RouteRuleRecord = { id: PREVIEW_ID, target, type: ruleType, value, createdAt: Date.now() };
    const rulesAfter = [...routeRules.filter((r) => !(r.type === ruleType && r.value === value)), preview];
    return matchingRouteRules(rulesAfter, {
      senderEmail: sender.email,
      senderDomain: sender.domain,
      subject: thread.subject,
    });
  }, [routeRules, ruleType, value, target, sender, thread.subject]);

  const outranking = previewMatches[0]?.id !== PREVIEW_ID ? previewMatches[0] : undefined;
  const canConfirm = !!value;
  const confirm = () => canConfirm && onConfirm(ruleType, value);

  return createPortal(
    <div
      className={s.overlay}
      onClick={onCancel}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <div
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-rule-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="move-rule-title" className={s.title}>
          Move to {targetName}
        </h2>
        <p className={s.subtitle}>
          Choose what future mail should also move here. Counts are existing inbox mail that matches.
        </p>

        <div className={s.options} role="radiogroup" aria-label="Rule type">
          {sender.email && (
            <RuleOption
              active={ruleType === "email"}
              label={`From ${sender.email}`}
              count={countFor("email", sender.email)}
              onClick={() => setRuleType("email")}
            />
          )}
          {sender.domain && (
            <RuleOption
              active={ruleType === "domain"}
              label={`From anyone @${sender.domain}`}
              count={countFor("domain", sender.domain)}
              warning={
                isSharedMailboxDomain(sender.domain)
                  ? `${sender.domain} is shared by many people — this will match unrelated senders too.`
                  : undefined
              }
              onClick={() => setRuleType("domain")}
            />
          )}
          <RuleOption
            active={ruleType === "subject_keyword"}
            label="Subject contains"
            count={countFor("subject_keyword", subjectValue)}
            onClick={() => setRuleType("subject_keyword")}
          >
            {ruleType === "subject_keyword" && (
              <input
                type="text"
                autoFocus
                className={s.subjectInput}
                value={subjectValue}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setSubjectValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && confirm()}
              />
            )}
          </RuleOption>
        </div>

        {previousAtKey && previousAtKey.target !== target && (
          <Notice>
            This replaces your existing rule — {ruleTypeLabel[ruleType].toLowerCase()} “{value}” currently goes to{" "}
            {getCategoryMeta(previousAtKey.target, customBundles).name}.
          </Notice>
        )}
        {outranking && (
          <Notice>
            Your {ruleTypeLabel[outranking.type].toLowerCase()} rule “{outranking.value}” is more specific and will
            keep this sender in {getCategoryMeta(outranking.target, customBundles).name} instead.
          </Notice>
        )}
        {!outranking && previewMatches.length > 1 && (
          <p className={s.hint}>{previewMatches.length} rules match this sender — the most specific one wins.</p>
        )}

        <div className={s.actions}>
          <button type="button" className={s.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={s.confirmBtn}
            disabled={!canConfirm}
            autoFocus={initialType !== "subject_keyword"}
            onClick={confirm}
          >
            Move
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const RuleOption = ({
  active,
  label,
  count,
  warning,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  count: number;
  warning?: string;
  onClick: () => void;
  children?: React.ReactNode;
}) => (
  <div className={active ? s.optionActive : s.option}>
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className={s.optionRow}
      onClick={onClick}
    >
      <span className={s.radio} aria-hidden="true" />
      <span className={s.optionLabel}>{label}</span>
      <span className={s.optionCount}>{messageLabel(count)}</span>
    </button>
    {children}
    {warning && active && (
      <div className={s.optionWarning}>
        <Icon name="warning" className={s.optionWarningIcon} />
        <span>{warning}</span>
      </div>
    )}
  </div>
);

const Notice = ({ children }: { children: React.ReactNode }) => (
  <div className={s.notice}>
    <Icon name="info" className={s.noticeIcon} />
    <span>{children}</span>
  </div>
);

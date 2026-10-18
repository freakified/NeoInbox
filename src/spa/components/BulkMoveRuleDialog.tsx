import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getCategoryMeta } from "../../shared/categories";
import { matchingRouteRules } from "../../shared/routeRules";
import { isSharedMailboxDomain } from "../../shared/ruleSuggestion";
import { parseSender } from "../../shared/senders";
import type { Category, RouteRuleRecord } from "../../shared/types";
import { useCustomBundles, useRouteRules } from "../../store/mailStore";
import { type BulkMoveGroup, type BulkMovePlan, rulesForGroup } from "../lib/bulkMove";
import { Icon } from "./Icon";
import m from "./MoveRuleDialog.module.css";
import s from "./BulkMoveRuleDialog.module.css";

export type BulkRuleChoice = "domain" | "email";

const conversations = (n: number): string => `${n} conversation${n === 1 ? "" : "s"}`;

/**
 * The multi-select counterpart to MoveRuleDialog. A move is a rule, so moving
 * a mixed selection means one rule per sender group; each row picks domain or
 * exact sender, and unticking a row leaves those conversations where they are.
 */
export const BulkMoveRuleDialog = ({
  target,
  plan,
  onCancel,
  onConfirm,
}: {
  target: Category;
  plan: BulkMovePlan;
  onCancel: () => void;
  /** Only the ticked groups, each with the rule type chosen for it. */
  onConfirm: (choices: { group: BulkMoveGroup; type: BulkRuleChoice }[]) => void;
}) => {
  const customBundles = useCustomBundles();
  const targetName = getCategoryMeta(target, customBundles).name;

  const [choices, setChoices] = useState<Record<string, BulkRuleChoice | null>>(() =>
    Object.fromEntries(plan.groups.map((g) => [g.id, g.suggested])),
  );
  const [lastType, setLastType] = useState<Record<string, BulkRuleChoice>>(() =>
    Object.fromEntries(plan.groups.map((g) => [g.id, g.suggested])),
  );

  const chosen = plan.groups.flatMap((group) => {
    const type = choices[group.id];
    return type ? [{ group, type }] : [];
  });
  const movingCount = chosen.reduce((n, c) => n + c.group.threads.length, 0);

  const toggle = (group: BulkMoveGroup) =>
    setChoices((prev) => ({ ...prev, [group.id]: prev[group.id] ? null : lastType[group.id]! }));
  const choose = (group: BulkMoveGroup, type: BulkRuleChoice) => {
    setLastType((prev) => ({ ...prev, [group.id]: type }));
    setChoices((prev) => ({ ...prev, [group.id]: type }));
  };

  const confirm = () => movingCount > 0 && onConfirm(chosen);

  return createPortal(
    <div className={m.overlay} onClick={onCancel} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <div
        className={`${m.dialog} ${s.dialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-move-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="bulk-move-title" className={m.title}>
          Move to {targetName}
        </h2>
        <p className={m.subtitle}>Future mail from these senders will also go to {targetName}.</p>

        <div className={s.groups}>
          {plan.groups.map((group) => (
            <GroupRow
              key={group.id}
              group={group}
              target={target}
              choice={choices[group.id] ?? null}
              shownType={choices[group.id] ?? lastType[group.id]!}
              onToggle={() => toggle(group)}
              onChoose={(type) => choose(group, type)}
            />
          ))}
        </div>

        {plan.alreadyThere.length > 0 && (
          <p className={m.hint}>
            {conversations(plan.alreadyThere.length)} {plan.alreadyThere.length === 1 ? "is" : "are"} already in{" "}
            {targetName}.
          </p>
        )}
        {plan.unroutable.length > 0 && (
          <p className={m.hint}>
            {conversations(plan.unroutable.length)} {plan.unroutable.length === 1 ? "has" : "have"} no sender
            address to make a rule from and will stay put.
          </p>
        )}

        <div className={m.actions}>
          <button type="button" className={m.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={m.confirmBtn}
            disabled={movingCount === 0}
            autoFocus
            onClick={confirm}
          >
            Move {movingCount > 0 ? movingCount : ""}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const GroupRow = ({
  group,
  target,
  choice,
  shownType,
  onToggle,
  onChoose,
}: {
  group: BulkMoveGroup;
  target: Category;
  choice: BulkRuleChoice | null;
  /** The type the toggle shows, kept while the row is unticked. */
  shownType: BulkRuleChoice;
  onToggle: () => void;
  onChoose: (type: BulkRuleChoice) => void;
}) => {
  const routeRules = useRouteRules();
  const customBundles = useCustomBundles();
  const multipleSenders = group.emails.length > 1;

  const label =
    shownType === "domain"
      ? `Anyone @${group.domain}`
      : multipleSenders
        ? `${group.emails.length} senders @${group.domain}`
        : group.emails[0]!;

  // A more specific rule already pointing elsewhere keeps some of these
  // conversations' future mail out of the destination; say so up front.
  const outranking = useMemo((): RouteRuleRecord | undefined => {
    if (!choice) return undefined;
    const added: RouteRuleRecord[] = rulesForGroup(group, choice).map((r, i) => ({
      id: `__bulk-preview-${i}__`,
      target,
      ...r,
      createdAt: 0,
    }));
    const rulesAfter = [
      ...routeRules.filter((r) => !added.some((a) => a.type === r.type && a.value === r.value)),
      ...added,
    ];
    for (const thread of group.threads) {
      const sender = parseSender(thread.messages[0]?.author ?? "");
      const winner = matchingRouteRules(rulesAfter, {
        senderEmail: sender.email,
        senderDomain: sender.domain,
        subject: thread.subject,
      })[0];
      if (winner && !added.some((a) => a.id === winner.id) && winner.target !== target) return winner;
    }
    return undefined;
  }, [choice, group, routeRules, target]);

  return (
    <div className={choice ? s.groupOn : s.group}>
      <div className={s.groupRow}>
        <button
          type="button"
          role="checkbox"
          aria-checked={!!choice}
          className={s.groupMain}
          onClick={onToggle}
        >
          <span className={s.checkbox} aria-hidden="true">
            {choice && <Icon name="check" className={s.checkIcon} />}
          </span>
          <span className={s.groupText}>
            <span className={s.groupLabel}>{label}</span>
            <span className={s.groupCount}>{conversations(group.threads.length)}</span>
          </span>
        </button>
        {group.domain && (
          <div className={s.typeToggle} role="radiogroup" aria-label="Rule type">
            <button
              type="button"
              role="radio"
              aria-checked={shownType === "domain"}
              className={shownType === "domain" ? s.typeOn : s.type}
              onClick={() => onChoose("domain")}
            >
              Domain
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={shownType === "email"}
              className={shownType === "email" ? s.typeOn : s.type}
              onClick={() => onChoose("email")}
            >
              {multipleSenders ? "Senders" : "Sender"}
            </button>
          </div>
        )}
      </div>
      {choice === "domain" && isSharedMailboxDomain(group.domain) && (
        <div className={m.optionWarning}>
          <Icon name="warning" className={m.optionWarningIcon} />
          <span>{group.domain} is shared by many people — this will match unrelated senders too.</span>
        </div>
      )}
      {outranking && (
        <p className={s.groupNote}>
          Your rule for “{outranking.value}” is more specific and keeps some of this mail in{" "}
          {getCategoryMeta(outranking.target, customBundles).name}.
        </p>
      )}
    </div>
  );
};

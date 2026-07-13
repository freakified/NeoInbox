import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES, getCategoryMeta } from "../../shared/categories";
import { findRouteRule, matchingRouteRules, ruleTypeLabel } from "../../shared/routeRules";
import { parseSender } from "../../shared/senders";
import type { BuiltinCategory, Category, RouteRuleRecord, RouteRuleType, Thread } from "../../shared/types";
import { useCustomBundles, useMailStore, useRouteRules } from "../../store/mailStore";
import { Icon } from "./Icon";
import { MoveRuleDialog } from "./MoveRuleDialog";
import s from "./BundleMenu.module.css";

const MOVE_DESTINATIONS: BuiltinCategory[] = [
  "personal",
  ...(Object.entries(CATEGORIES)
    .filter(([cat]) => cat !== "personal")
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([cat]) => cat as BuiltinCategory)),
];

export const BundleMenu = ({
  thread,
  onTranslateToEnglish,
}: {
  thread: Thread;
  onTranslateToEnglish: () => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [view, setView] = useState<"root" | "move">("root");
  const [movePrompt, setMovePrompt] = useState<Category | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const customBundles = useCustomBundles();
  const routeRules = useRouteRules();
  const setRouteRule = useMailStore((st) => st.setRouteRule);
  const deleteRouteRule = useMailStore((st) => st.deleteRouteRule);
  const applyCategoryLocally = useMailStore((st) => st.applyCategoryLocally);
  const notify = useMailStore((st) => st.notify);
  const openBundleSettings = useMailStore((st) => st.openBundleSettings);

  const sender = useMemo(
    () => parseSender(thread.messages[0]?.author ?? ""),
    [thread],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const openMenu = (open: boolean) => {
    setView("root");
    setMenuOpen(open);
  };

  const destinationName = (target: Category): string =>
    getCategoryMeta(target, customBundles).name;

  const moveTo = (target: Category) => {
    setMenuOpen(false);
    if (!sender.domain && !sender.email) {
      // No sender to build a rule from; let the user add a subject rule instead.
      openBundleSettings({ category: target, thread });
      return;
    }
    setMovePrompt(target);
  };

  const commitMove = (target: Category, type: RouteRuleType, value: string) => {
    setMovePrompt(null);
    const previous = findRouteRule(routeRules, type, value);
    const rule: RouteRuleRecord = {
      id: crypto.randomUUID(),
      target,
      type,
      value,
      createdAt: Date.now(),
    };
    const messageIds = thread.messages.map((m) => m.id);
    const previousCategory = thread.category;

    applyCategoryLocally(messageIds, target === "personal" ? null : target);
    setRouteRule(rule);

    // A more specific existing rule (e.g. exact sender vs. this domain rule)
    // can still claim this sender's future mail; warn instead of promising.
    const rulesAfter = [
      ...routeRules.filter((r) => r.id !== rule.id && !(r.type === rule.type && r.value === rule.value)),
      rule,
    ];
    const winner = matchingRouteRules(rulesAfter, {
      senderEmail: sender.email,
      senderDomain: sender.domain,
      subject: thread.subject,
    })[0];
    const outranking = winner && winner.id !== rule.id && winner.target !== target ? winner : undefined;

    const name = destinationName(target);
    const message = outranking
      ? `Rule added, but your ${ruleTypeLabel[outranking.type].toLowerCase()} rule for “${outranking.value}” outranks it and keeps this sender in ${destinationName(outranking.target)}`
      : previous && previous.target !== target
        ? `Future mail from ${value} goes to ${name} instead of ${destinationName(previous.target)}`
        : `Future mail from ${value} goes to ${name}`;
    notify(message, [
      {
        label: "Undo",
        run: () => {
          if (previous) setRouteRule(previous);
          else deleteRouteRule(rule.id);
          applyCategoryLocally(messageIds, previousCategory);
        },
      },
      {
        label: "Edit rule",
        run: () =>
          openBundleSettings({
            category: outranking ? outranking.target : target,
            thread,
            highlightRuleId: (outranking ?? rule).id,
          }),
      },
    ]);
  };

  const currentCategory: Category = thread.category ?? "personal";

  return (
    <div className={s.wrapper} ref={wrapperRef}>
      <button
        type="button"
        title="More actions"
        onClick={(e) => {
          e.stopPropagation();
          openMenu(!menuOpen);
        }}
        className={s.trigger}
      >
        <Icon name="more_vert" className={s.triggerIcon} />
      </button>
      {menuOpen && (
        <div className={s.menu} role="menu" onClick={(e) => e.stopPropagation()}>
          {view === "root" ? (
            <>
              <button
                type="button"
                className={s.menuItem}
                role="menuitem"
                onClick={() => setView("move")}
              >
                <Icon name="drive_file_move" className={s.menuIcon} />
                <span className={s.menuItemLabel}>Move to</span>
                <Icon name="chevron_right" className={s.menuChevron} />
              </button>
              <button
                type="button"
                className={s.menuItem}
                role="menuitem"
                onClick={() => {
                  onTranslateToEnglish();
                  setMenuOpen(false);
                }}
              >
                <Icon name="translate" className={s.menuIcon} />
                <span className={s.menuItemLabel}>Translate to English</span>
              </button>
              <button
                type="button"
                className={s.menuItem}
                role="menuitem"
                onClick={() => {
                  openBundleSettings({ category: thread.category, thread });
                  setMenuOpen(false);
                }}
              >
                <Icon name="settings" className={s.menuIcon} />
                <span className={s.menuItemLabel}>Bundle settings</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={s.menuBackItem}
                onClick={() => setView("root")}
              >
                <Icon name="arrow_back" className={s.menuIcon} />
                <span className={s.menuItemLabel}>Move to</span>
              </button>
              <div className={s.menuScroll}>
                {MOVE_DESTINATIONS.map((cat) => (
                  <DestinationItem
                    key={cat}
                    name={CATEGORIES[cat].name}
                    icon={CATEGORIES[cat].icon}
                    color={CATEGORIES[cat].color}
                    current={currentCategory === cat}
                    onClick={() => moveTo(cat)}
                  />
                ))}
                {customBundles.map((bundle) => (
                  <DestinationItem
                    key={bundle.id}
                    name={bundle.name}
                    icon={bundle.icon}
                    color={bundle.color}
                    current={currentCategory === bundle.id}
                    onClick={() => moveTo(bundle.id)}
                  />
                ))}
              </div>
              <button
                type="button"
                className={s.menuItem}
                role="menuitem"
                onClick={() => {
                  openBundleSettings({ thread, startNewBundle: true });
                  setMenuOpen(false);
                }}
              >
                <Icon name="add" className={s.menuIcon} />
                <span className={s.menuItemLabel}>New bundle…</span>
              </button>
            </>
          )}
        </div>
      )}
      {movePrompt !== null && (
        <MoveRuleDialog
          target={movePrompt}
          thread={thread}
          sender={sender}
          onCancel={() => setMovePrompt(null)}
          onConfirm={(type, value) => commitMove(movePrompt, type, value)}
        />
      )}
    </div>
  );
};

const DestinationItem = ({
  name,
  icon,
  color,
  current,
  onClick,
}: {
  name: string;
  icon: string;
  color: string;
  current: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    className={s.menuItem}
    role="menuitem"
    disabled={current}
    onClick={onClick}
  >
    <Icon name={icon} className={s.menuIcon} style={{ color }} />
    <span className={s.menuItemLabel}>{name}</span>
    {current && <Icon name="check" className={s.menuCheck} />}
  </button>
);

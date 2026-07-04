import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES, getCategoryMeta } from "../../shared/categories";
import { findRouteRule, normalizeRuleValue } from "../../shared/routeRules";
import { parseSender } from "../../shared/senders";
import type { BuiltinCategory, Category, RouteRuleRecord, Thread } from "../../shared/types";
import { useCustomBundles, useMailStore, useRouteRules } from "../../store/mailStore";
import { BundleManagerModal } from "./BundleManagerModal";
import { Icon } from "./Icon";
import s from "./BundleMenu.module.css";

const MOVE_DESTINATIONS: BuiltinCategory[] = [
  "personal",
  ...(Object.entries(CATEGORIES)
    .filter(([cat]) => cat !== "personal")
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([cat]) => cat as BuiltinCategory)),
];

type ModalState =
  | { kind: "closed" }
  | { kind: "bundle"; category: Category | null }
  | { kind: "new" };

export const BundleMenu = ({
  thread,
  onTranslateToEnglish,
}: {
  thread: Thread;
  onTranslateToEnglish: () => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [view, setView] = useState<"root" | "move">("root");
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const wrapperRef = useRef<HTMLDivElement>(null);

  const customBundles = useCustomBundles();
  const routeRules = useRouteRules();
  const setRouteRule = useMailStore((st) => st.setRouteRule);
  const deleteRouteRule = useMailStore((st) => st.deleteRouteRule);
  const applyCategoryLocally = useMailStore((st) => st.applyCategoryLocally);
  const notify = useMailStore((st) => st.notify);

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
    const type = sender.domain ? "domain" : sender.email ? "email" : null;
    if (!type) {
      // No sender to build a rule from; let the user add a subject rule instead.
      setModal({ kind: "bundle", category: target });
      return;
    }
    const value = normalizeRuleValue(type, type === "domain" ? sender.domain : sender.email);
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

    const name = destinationName(target);
    const message =
      previous && previous.target !== target
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
      { label: "Edit rule", run: () => setModal({ kind: "bundle", category: target }) },
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
                  setModal({ kind: "bundle", category: thread.category });
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
                  setModal({ kind: "new" });
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
      {modal.kind !== "closed" && (
        <BundleManagerModal
          thread={thread}
          initialCategory={modal.kind === "bundle" ? modal.category : null}
          startNewBundle={modal.kind === "new"}
          onClose={() => setModal({ kind: "closed" })}
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

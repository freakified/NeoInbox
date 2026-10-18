import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCategoryMeta } from "../../shared/categories";
import { findRouteRule, matchingRouteRules, ruleTypeLabel } from "../../shared/routeRules";
import { parseSender } from "../../shared/senders";
import { suggestTrips, tripIdOfThread, tripKeysOfThread } from "../../shared/trips";
import type { Category, RouteRuleRecord, RouteRuleType, Thread } from "../../shared/types";
import {
  useCustomBundles,
  useMailStore,
  useRouteRules,
  useTripMemberships,
  useTrips,
} from "../../store/mailStore";
import { useAnchoredMenu } from "../lib/useAnchoredMenu";
import { Icon } from "./Icon";
import { MoveDestinations } from "./MoveDestinations";
import { MoveRuleDialog } from "./MoveRuleDialog";
import { NewTripDialog } from "./NewTripDialog";
import { TripPickerDialog } from "./TripPickerDialog";
import s from "./BundleMenu.module.css";

export const BundleMenu = ({
  thread,
  onTranslateToEnglish,
}: {
  thread: Thread;
  /** Omitted where there's no open message to translate (the row hover bar). */
  onTranslateToEnglish?: () => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [view, setView] = useState<"root" | "move">("root");
  const [movePrompt, setMovePrompt] = useState<Category | null>(null);
  const [newTripOpen, setNewTripOpen] = useState(false);
  const [tripPickerOpen, setTripPickerOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The menu is portaled out of the row so later rows (each its own stacking
  // context) can't paint over it.
  const menuStyle = useAnchoredMenu(menuOpen, triggerRef, menuRef, view);

  const customBundles = useCustomBundles();
  const routeRules = useRouteRules();
  const tripsById = useTrips();
  const tripMemberships = useTripMemberships();
  const setRouteRule = useMailStore((st) => st.setRouteRule);
  const deleteRouteRule = useMailStore((st) => st.deleteRouteRule);
  const applyCategoryLocally = useMailStore((st) => st.applyCategoryLocally);
  const setTripMembership = useMailStore((st) => st.setTripMembership);
  const notify = useMailStore((st) => st.notify);
  const openBundleSettings = useMailStore((st) => st.openBundleSettings);

  const currentTripId = tripIdOfThread(thread, tripMemberships);
  const allTrips = useMemo(() => Object.values(tripsById), [tripsById]);
  // Only computed while the menu is open, so a stale "now" can't linger.
  const suggestedTrips = useMemo(
    () => (menuOpen ? suggestTrips(allTrips, thread, currentTripId, Date.now()) : []),
    [menuOpen, allTrips, thread, currentTripId],
  );
  const moreTrips = allTrips.length > suggestedTrips.length;

  // setTripMembership owns the toast: only it knows whether the move emptied
  // (and so deleted) the trip the thread came from, and its Undo has to
  // restore that trip as well as the membership rows.
  const moveToTrip = (tripId: string) => {
    setMenuOpen(false);
    setTripMembership(tripKeysOfThread(thread), tripId);
  };

  const removeFromTrip = () => {
    setMenuOpen(false);
    setTripMembership(tripKeysOfThread(thread), null);
  };

  const sender = useMemo(
    () => parseSender(thread.messages[0]?.author ?? ""),
    [thread],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setMenuOpen(false);
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
    const messageKeys = thread.messages.map((m) => m.key);
    const previousCategory = thread.category;

    applyCategoryLocally(messageKeys, target === "personal" ? null : target);
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
          applyCategoryLocally(messageKeys, previousCategory);
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
        ref={triggerRef}
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
      {menuOpen && createPortal(
        <div
          ref={menuRef}
          className={s.menu}
          style={menuStyle}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
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
              {onTranslateToEnglish && (
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
              )}
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
              <MoveDestinations
                currentCategory={currentCategory}
                currentTripId={currentTripId}
                suggestedTrips={suggestedTrips}
                moreTrips={moreTrips}
                canRemoveFromTrip={!!currentTripId}
                onCategory={moveTo}
                onTrip={moveToTrip}
                onMoreTrips={() => {
                  setMenuOpen(false);
                  setTripPickerOpen(true);
                }}
                onRemoveFromTrip={removeFromTrip}
                onNewTrip={() => {
                  setMenuOpen(false);
                  setNewTripOpen(true);
                }}
                onNewBundle={() => {
                  openBundleSettings({ thread, startNewBundle: true });
                  setMenuOpen(false);
                }}
              />
            </>
          )}
        </div>,
        document.body,
      )}
      {tripPickerOpen && (
        <TripPickerDialog
          subject={thread.subject}
          currentTripId={currentTripId}
          onPick={(tripId) => {
            setTripPickerOpen(false);
            moveToTrip(tripId);
          }}
          onClose={() => setTripPickerOpen(false)}
        />
      )}
      {newTripOpen && (
        <NewTripDialog threads={[thread]} onClose={() => setNewTripOpen(false)} />
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

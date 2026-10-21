import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCategoryMeta } from "../../shared/categories";
import { findRouteRule } from "../../shared/routeRules";
import { suggestTrips, tripIdOfThread, tripKeysOfThread } from "../../shared/trips";
import type { Category, RouteRuleRecord, Thread } from "../../shared/types";
import {
  useCustomBundles,
  useMailStore,
  useRouteRules,
  useTripMemberships,
  useTrips,
} from "../../store/mailStore";
import { type BulkMoveGroup, type BulkMovePlan, planBulkMove, rulesForGroup } from "../lib/bulkMove";
import { useAnchoredMenu } from "../lib/useAnchoredMenu";
import { useMenuFocus } from "../lib/useMenuFocus";
import { BulkMoveRuleDialog, type BulkRuleChoice } from "./BulkMoveRuleDialog";
import { Icon } from "./Icon";
import { MoveDestinations } from "./MoveDestinations";
import { NewTripDialog } from "./NewTripDialog";
import { TripPickerDialog } from "./TripPickerDialog";
import menu from "./BundleMenu.module.css";

const conversations = (n: number): string => `${n} conversation${n === 1 ? "" : "s"}`;

/** The one value every item shares, or null when they differ. */
const common = <T,>(values: T[]): T | null =>
  values.length > 0 && values.every((v) => v === values[0]) ? values[0]! : null;

/**
 * "Move to" for the selection bar: the same destinations as a row's menu,
 * applied to every selected conversation. Trips take the lot directly;
 * bundles go through BulkMoveRuleDialog, since a bundle move is a rule.
 */
export const SelectionMoveMenu = ({
  threads,
  triggerClassName,
  iconClassName,
  onDone,
}: {
  threads: Thread[];
  triggerClassName?: string;
  iconClassName?: string;
  /** Called once a move is committed, to clear the selection. */
  onDone: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [rulePrompt, setRulePrompt] = useState<{ target: Category; plan: BulkMovePlan } | null>(null);
  const [newTripOpen, setNewTripOpen] = useState(false);
  const [tripPickerOpen, setTripPickerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuStyle = useAnchoredMenu(open, triggerRef, menuRef);
  const menuFocus = useMenuFocus({ open, onClose: () => setOpen(false), triggerRef, menuRef });

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

  const tripIds = threads.map((t) => tripIdOfThread(t, tripMemberships));
  const currentTripId = common(tripIds);
  const currentCategory = common(threads.map((t): Category => t.category ?? "personal"));
  const allTrips = useMemo(() => Object.values(tripsById), [tripsById]);
  // Suggest around the newest selected conversation; a selection usually
  // clusters in time, and it's the one the user most likely just looked at.
  const newest = useMemo(
    () => threads.reduce<Thread | undefined>((a, t) => (!a || t.latestDate > a.latestDate ? t : a), undefined),
    [threads],
  );
  const suggestedTrips = useMemo(
    () => (open && newest ? suggestTrips(allTrips, newest, currentTripId, Date.now()) : []),
    [open, allTrips, newest, currentTripId],
  );

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  // setTripMembership owns the toast and its Undo, as for a single thread.
  const moveToTrip = (tripId: string | null) => {
    setOpen(false);
    const moving = tripId ? threads : threads.filter((_, i) => tripIds[i]);
    setTripMembership(moving.flatMap(tripKeysOfThread), tripId);
    onDone();
  };

  const moveTo = (target: Category) => {
    setOpen(false);
    setRulePrompt({ target, plan: planBulkMove(threads, target) });
  };

  const commitMove = (target: Category, choices: { group: BulkMoveGroup; type: BulkRuleChoice }[]) => {
    setRulePrompt(null);
    const now = Date.now();
    const added = choices.flatMap(({ group, type }) =>
      rulesForGroup(group, type).map(({ type: ruleType, value }) => ({
        rule: { id: crypto.randomUUID(), target, type: ruleType, value, createdAt: now } as RouteRuleRecord,
        previous: findRouteRule(routeRules, ruleType, value),
      })),
    );
    const moved = choices.flatMap(({ group }) => group.threads);
    const previousCategories = moved.map((t) => ({ keys: t.messages.map((m) => m.key), category: t.category }));

    applyCategoryLocally(
      previousCategories.flatMap((p) => p.keys),
      target === "personal" ? null : target,
    );
    for (const { rule } of added) setRouteRule(rule);

    const name = getCategoryMeta(target, customBundles).name;
    const rulesNote = added.length === 1 ? "1 rule added" : `${added.length} rules added`;
    notify(`Moved ${conversations(moved.length)} to ${name} · ${rulesNote}`, [
      {
        label: "Undo",
        run: () => {
          for (const { rule, previous } of added) {
            if (previous) setRouteRule(previous);
            else deleteRouteRule(rule.id);
          }
          for (const p of previousCategories) applyCategoryLocally(p.keys, p.category);
        },
      },
      { label: "Edit rules", run: () => openBundleSettings({ category: target }) },
    ]);
    onDone();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        title="Move to"
        aria-label="Move to"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="drive_file_move" className={iconClassName} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className={menu.menu}
          style={menuStyle}
          role="menu"
          aria-label={`Move ${conversations(threads.length)} to`}
          {...menuFocus}
        >
          {/* The menu's label says this already. */}
          <div className={menu.menuHeader} aria-hidden="true">
            <Icon name="drive_file_move" className={menu.menuIcon} />
            <span className={menu.menuItemLabel}>Move {conversations(threads.length)} to</span>
          </div>
          <MoveDestinations
            currentCategory={currentCategory}
            currentTripId={currentTripId}
            suggestedTrips={suggestedTrips}
            moreTrips={allTrips.length > suggestedTrips.length}
            canRemoveFromTrip={tripIds.some(Boolean)}
            onCategory={moveTo}
            onTrip={moveToTrip}
            onMoreTrips={() => {
              setOpen(false);
              setTripPickerOpen(true);
            }}
            onRemoveFromTrip={() => moveToTrip(null)}
            onNewTrip={() => {
              setOpen(false);
              setNewTripOpen(true);
            }}
            onNewBundle={() => {
              setOpen(false);
              openBundleSettings({ startNewBundle: true });
            }}
          />
        </div>,
        document.body,
      )}
      {tripPickerOpen && (
        <TripPickerDialog
          subject={conversations(threads.length)}
          currentTripId={currentTripId}
          onPick={(tripId) => {
            setTripPickerOpen(false);
            moveToTrip(tripId);
          }}
          onClose={() => setTripPickerOpen(false)}
        />
      )}
      {newTripOpen && (
        <NewTripDialog
          threads={threads}
          onClose={() => setNewTripOpen(false)}
          onCreated={onDone}
        />
      )}
      {rulePrompt && (
        <BulkMoveRuleDialog
          target={rulePrompt.target}
          plan={rulePrompt.plan}
          onCancel={() => setRulePrompt(null)}
          onConfirm={(choices) => commitMove(rulePrompt.target, choices)}
        />
      )}
    </>
  );
};

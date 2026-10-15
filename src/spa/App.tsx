import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutGroup, useReducedMotion } from "framer-motion";
import {
  useBundleSettings,
  useConnectionState,
  useHydrated,
  useMailStore,
  useStreamForView,
  useSyncProgress,
  type StreamItem,
  type StreamSection,
  type StreamView,
} from "../store/mailStore";
import { CATEGORIES, getCategoryMeta } from "../shared/categories";
import { useShowDeleteActions } from "./lib/deleteActionPrefs";
import { useScrollAnchor } from "./lib/useScrollAnchor";
import { BundleSliceRow } from "./components/BundleSliceRow";
import { BundleManagerModal } from "./components/BundleManagerModal";
import { useBulkActions } from "./components/BulkActionConfirm";
import { Fab } from "./components/Fab";
import { Icon } from "./components/Icon";
import { ReminderRow } from "./components/ReminderRow";
import { SelectionBar } from "./components/SelectionBar";
import { MotionSurface } from "./components/Motion";
import { SectionLabel } from "./components/SectionLabel";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { ThreadRow } from "./components/ThreadRow";
import { Toaster } from "./components/Toaster";
import { overlayIsOpen } from "./lib/overlays";
import { moveRowFocus } from "./lib/rowNavigation";
import { useSelection, visibleThreadIds } from "./lib/selection";
import { TRIP_COLOR, TripSliceRow } from "./components/TripSliceRow";
import { isSameView, parseHashView, viewHash } from "./lib/routing";
import s from "./App.module.css";

const STREAM_PAGE_SIZE = 80;

/** App bar color while conversations are selected, whatever the view's own. */
const SELECTION_HEADER_COLOR = "#5f6368";


const emptyTextForView = (view: StreamView, pinnedOnly: boolean): string => {
  if (view.type === "inbox" && pinnedOnly) return "No pinned messages.";
  if (view.type === "snoozed") return "No snoozed messages.";
  if (view.type === "draft") return "No drafts.";
  if (view.type === "sent") return "No sent messages.";
  if (view.type === "done") return "No done messages.";
  if (view.type === "reminders") return "No reminders — create one with the button below.";
  if (view.type === "trips")
    return "No trips yet — open a conversation's ⋮ menu and choose Move to → New trip.";
  if (view.type === "bundle") return "No messages in this bundle.";
  return "No messages found.";
};

const headerForView = (
  view: StreamView,
  customBundles: ReturnType<typeof useMailStore.getState>["customBundles"],
): { title: string; color: string } => {
  if (view.type === "snoozed") return { title: "Snoozed", color: "#DF742C" };
  if (view.type === "draft") return { title: "Drafts", color: "#C5221F" };
  if (view.type === "done") return { title: "Done", color: "#5CA46F" };
  if (view.type === "sent") return { title: "Sent", color: "var(--color-md-primary)" };
  if (view.type === "reminders") return { title: "Reminders", color: "var(--color-md-primary)" };
  if (view.type === "trips") return { title: "Trips", color: "#3F51B5" };
  if (view.type === "bundle") {
    const meta = getCategoryMeta(view.category, customBundles);
    return { title: meta.name, color: meta.color };
  }
  return { title: "Inbox", color: "var(--color-md-primary)" };
};

// Reminders live in the stream but are never part of bulk sweeps.
const threadsOfItem = (item: StreamItem) =>
  item.type === "thread"
    ? [item.thread]
    : item.type === "bundle" || item.type === "trip"
      ? item.threads
      : [];

type GroupItem = Extract<StreamItem, { type: "bundle" } | { type: "trip" }>;

/** Expansion key for the two openable group row kinds (bundles and trips). */
const groupKeyOf = (item: StreamItem): string | null =>
  item.type === "bundle"
    ? `bundle:${item.category}`
    : item.type === "trip"
      ? `trip:${item.trip.id}`
      : null;

const isGroupKey = (key: string): boolean =>
  key.startsWith("bundle:") || key.startsWith("trip:");

// Single-letter shortcuts must never eat a keystroke meant for a compose box,
// a rename field, or the bundle-rule editor.
const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
};

/** `g` prefix targets, Gmail/Inbox style. */
const GO_TO_VIEWS: Record<string, StreamView> = {
  i: { type: "inbox" },
  s: { type: "snoozed" },
  d: { type: "done" },
  r: { type: "reminders" },
  t: { type: "trips" },
};

// Sweeps skip pinned threads, so a section of only pinned mail has nothing to sweep.
const canDoneSection = (items: StreamItem[]): boolean =>
  items.some((item) =>
    threadsOfItem(item).some((t) => !t.pinned && t.messages.some((m) => m.origin === "inbox")),
  );

const limitSections = (
  sections: StreamSection[],
  limit: number,
): { sections: StreamSection[]; visibleCount: number; totalCount: number } => {
  let remaining = limit;
  let visibleCount = 0;
  let totalCount = 0;
  const visible: StreamSection[] = [];

  for (const section of sections) {
    totalCount += section.items.length;
    if (remaining <= 0) continue;
    const items = section.items.slice(0, remaining);
    if (!items.length) continue;
    visible.push({ ...section, items });
    visibleCount += items.length;
    remaining -= items.length;
  }

  return { sections: visible, visibleCount, totalCount };
};

export const App = () => {
  const init = useMailStore((st) => st.init);
  const hydrated = useHydrated();
  const sync = useSyncProgress();
  const connectionState = useConnectionState();
  const retryBackfill = useMailStore((st) => st.retryBackfill);
  const inboxWindow = useMailStore((st) => st.inboxWindow);
  const loadingMoreInbox = useMailStore((st) => st.loadingMoreInbox);
  const loadMoreInbox = useMailStore((st) => st.loadMoreInbox);
  const customBundles = useMailStore((st) => st.customBundles);
  const showDeleteActions = useShowDeleteActions();

  const { doneMessages, trashMessages } = useBulkActions();

  // Bulk sweeps never touch pinned threads — that's the point of pinning.
  const sectionDoneAll = (items: StreamItem[]) => {
    const ids = items.flatMap((item) =>
      threadsOfItem(item)
        .filter((t) => !t.pinned)
        .flatMap((t) => t.messages.filter((m) => m.origin === "inbox").map((m) => m.id)),
    );
    doneMessages(ids);
  };

  const sectionTrashAll = (items: StreamItem[]) => {
    const ids = items.flatMap((item) =>
      threadsOfItem(item)
        .filter((t) => !t.pinned)
        .flatMap((t) => t.messages.map((m) => m.id)),
    );
    trashMessages(ids);
  };

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [openBundleThreadId, setOpenBundleThreadId] = useState<string | null>(null);
  const expandedRef = useRef<HTMLDivElement | null>(null);
  const bundleSettings = useBundleSettings();
  const openBundleSettings = useMailStore((st) => st.openBundleSettings);
  const closeBundleSettings = useMailStore((st) => st.closeBundleSettings);
  const [activeView, setActiveView] = useState<StreamView>(parseHashView);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const stream = useStreamForView(activeView, pinnedOnly);
  const [visibleItemLimit, setVisibleItemLimit] = useState(STREAM_PAGE_SIZE);
  const [drawerOpen, setDrawerOpen] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 980px)").matches,
  );
  const [showShortcuts, setShowShortcuts] = useState(false);
  const goPrefixRef = useRef(false);
  const reducedMotion = useReducedMotion();
  const selectedIds = useSelection((st) => st.ids);
  const clearSelection = useSelection((st) => st.clear);
  const retainSelection = useSelection((st) => st.retain);
  const selectAll = useSelection((st) => st.selectAll);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const onHashChange = () => {
      setActiveView(parseHashView());
      useSelection.getState().clear();
      setExpandedKey(null);
      setOpenBundleThreadId(null);
      setVisibleItemLimit(STREAM_PAGE_SIZE);
    };
    window.addEventListener("hashchange", onHashChange);
    onHashChange();
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (expandedKey) {
      expandedRef.current?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "nearest",
      });
    }
  }, [expandedKey, reducedMotion]);

  // A reply you send re-sorts the thread (it's newest now); keep it under you.
  useScrollAnchor(expandedRef, expandedKey);

  const toggleKey = (key: string) => {
    setOpenBundleThreadId(null);
    setExpandedKey((prev) => (prev === key ? null : key));
  };

  const syncing = !!sync && !sync.done;
  const syncFailed = !!sync?.done && !!sync.error;
  const reconnecting = connectionState === "reconnecting";
  // Trips isn't listed with the bundles: like Google Inbox, it gets a
  // top-level drawer entry (each trip also rows up in the inbox on its own).
  const bundles = useMemo(
    () => [
      ...Object.keys(CATEGORIES).filter((category) => category !== "personal"),
      ...customBundles.map((bundle) => bundle.id),
    ].map((category) => ({
      id: category,
      meta: getCategoryMeta(category, customBundles),
    })),
    [customBundles],
  );
  // Stable so the global key listener below isn't torn down and re-added on
  // every render of the stream.
  const navigate = useCallback((view: StreamView) => {
    setExpandedKey(null);
    setOpenBundleThreadId(null);
    if (typeof window !== "undefined") {
      const nextHash = viewHash(view);
      if (window.location.hash === nextHash) setActiveView(view);
      else window.location.hash = nextHash;
      if (window.matchMedia("(max-width: 979px)").matches) setDrawerOpen(false);
    } else {
      setActiveView(view);
    }
  }, []);
  // List-wide keys. Row-scoped ones (e/s/p/#) are handled by the focused row so
  // they always act on what the cursor is actually on.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (overlayIsOpen()) return;

      if (goPrefixRef.current) {
        goPrefixRef.current = false;
        const view = GO_TO_VIEWS[e.key];
        if (view) {
          e.preventDefault();
          // The second key of a `g` chord overlaps the row shortcuts (`g s` vs
          // snooze). Stopping it here, in the capture phase, keeps it from ever
          // reaching the focused row.
          e.stopPropagation();
          navigate(view);
          return;
        }
      }

      if (e.key === "j" || e.key === "ArrowDown") {
        if (moveRowFocus(1)) e.preventDefault();
      } else if (e.key === "k" || e.key === "ArrowUp") {
        if (moveRowFocus(-1)) e.preventDefault();
      } else if (e.key === "Escape") {
        if (useSelection.getState().ids.size > 0) useSelection.getState().clear();
        else if (openBundleThreadId) setOpenBundleThreadId(null);
        else if (expandedKey) setExpandedKey(null);
      } else if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts(true);
      } else if (e.key === "g") {
        goPrefixRef.current = true;
        window.setTimeout(() => {
          goPrefixRef.current = false;
        }, 1200);
      }
    };

    // Capture phase: React dispatches row handlers from the root container on
    // the way back up, so this runs first and can claim a key outright.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [expandedKey, navigate, openBundleThreadId]);

  const navClass = (view: StreamView) =>
    `${s.navItem} ${isSameView(activeView, view) ? s.navItemActive : ""}`;
  const unsupportedClass = `${s.navItem} ${s.navItemDisabled}`;
  const showDoneAll = activeView.type === "inbox" || activeView.type === "bundle";
  const header = headerForView(activeView, customBundles);
  const visibleStream = useMemo(
    () => limitSections(stream.sections, visibleItemLimit),
    [stream.sections, visibleItemLimit],
  );
  const hasMoreItems = visibleStream.visibleCount < visibleStream.totalCount;
  // Every thread in the view, bundled or not, so selections inside an open
  // bundle resolve too. Selected ids that leave the stream (done, snoozed,
  // moved by another client) drop out of the selection with them.
  const streamThreads = useMemo(
    () => stream.sections.flatMap((section) => section.items.flatMap(threadsOfItem)),
    [stream.sections],
  );
  useEffect(() => {
    retainSelection(new Set(streamThreads.map((t) => t.id)));
  }, [retainSelection, streamThreads]);
  const selectedThreads = useMemo(
    () => streamThreads.filter((t) => selectedIds.has(t.id)),
    [selectedIds, streamThreads],
  );
  const selecting = selectedThreads.length > 0;
  // Older mail only exists to fetch in the views actually backed by the inbox
  // scan; Done, Sent and Drafts are not reached by widening that window.
  const canLoadOlderMail =
    (activeView.type === "inbox" ||
      activeView.type === "bundle" ||
      activeView.type === "trips") &&
    (inboxWindow?.skipped ?? 0) > 0;

  return (
    <div
      className={`${s.root} ${drawerOpen ? s.drawerOpen : ""}`}
      onClick={(e) => {
        if (!expandedKey) return;
        if (!(e.target as HTMLElement).closest("[data-row]")) {
          if (isGroupKey(expandedKey) && openBundleThreadId) {
            setOpenBundleThreadId(null);
            return;
          }

          setExpandedKey(null);
        }
      }}
    >
      {showShortcuts && <ShortcutsHelp onClose={() => setShowShortcuts(false)} />}

      {bundleSettings && (
        <BundleManagerModal
          onClose={closeBundleSettings}
          thread={bundleSettings.thread}
          initialCategory={bundleSettings.category}
          startNewBundle={bundleSettings.startNewBundle}
          highlightRuleId={bundleSettings.highlightRuleId}
        />
      )}

      <header
        className={s.header}
        style={{ backgroundColor: selecting ? SELECTION_HEADER_COLOR : header.color }}
      >
        {selecting ? (
          <SelectionBar
            threads={selectedThreads}
            onClear={clearSelection}
            onSelectAll={() => selectAll(visibleThreadIds())}
          />
        ) : (
          <>
            <div className={s.headerLeft}>
              <button
                type="button"
                className={s.menuBtn}
                title={drawerOpen ? "Hide navigation" : "Show navigation"}
                aria-label={drawerOpen ? "Hide navigation" : "Show navigation"}
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen((open) => !open)}
              >
                <Icon name="menu" className={s.menuIcon} />
              </button>
              <h1 className={s.title}>{header.title}</h1>
            </div>
            <div className={s.headerRight}>
              {syncing && sync && (
                <span className={s.syncText}>
                  Scanning... {sync.scanned} messages, {sync.classified} classified
                </span>
              )}
              {syncFailed && (
                <button
                  type="button"
                  className={s.syncErrorPill}
                  onClick={retryBackfill}
                  title={sync?.error ?? "Sync failed"}
                >
                  Sync failed — retry
                </button>
              )}
              {reconnecting && <span className={s.reconnectText}>Reconnecting…</span>}
              {activeView.type === "inbox" && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={pinnedOnly}
                  aria-label={pinnedOnly ? "Show all mail" : "Show pinned only"}
                  title={pinnedOnly ? "Show all mail" : "Show pinned only"}
                  className={`${s.pinToggle} ${pinnedOnly ? s.pinToggleOn : ""}`}
                  onClick={() => setPinnedOnly((v) => !v)}
                >
                  <span className={s.pinToggleTrack} />
                  <span className={s.pinToggleKnob}>
                    <Icon name="push_pin" className={s.pinToggleIcon} />
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowShortcuts(true)}
                title="Keyboard shortcuts (?)"
                aria-label="Keyboard shortcuts"
                className={s.settingsBtn}
              >
                <Icon name="keyboard" className={s.settingsIcon} />
              </button>
              <button
                onClick={() => openBundleSettings({})}
                title="Settings"
                aria-label="Settings"
                className={s.settingsBtn}
              >
                <Icon name="settings" className={s.settingsIcon} />
              </button>
            </div>
          </>
        )}
      </header>

      <div className={s.appShell}>
        {drawerOpen && (
          <button
            type="button"
            className={s.drawerScrim}
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
          />
        )}

        <aside className={s.drawer} aria-label="Mailbox navigation">
          <nav className={s.drawerNav}>
            <div className={s.drawerGroup}>
              <button type="button" className={navClass({ type: "inbox" })} onClick={() => navigate({ type: "inbox" })}>
                <Icon name="inbox" className={s.navIcon} />
                <span>Inbox</span>
              </button>
              <button type="button" className={navClass({ type: "snoozed" })} onClick={() => navigate({ type: "snoozed" })}>
                <Icon name="schedule" className={s.navIcon} />
                <span>Snoozed</span>
              </button>
              <button type="button" className={navClass({ type: "done" })} onClick={() => navigate({ type: "done" })}>
                <Icon name="done" className={s.navIcon} />
                <span>Done</span>
              </button>
            </div>

            <div className={s.drawerGroup}>
              <button type="button" className={navClass({ type: "draft" })} onClick={() => navigate({ type: "draft" })}>
                <Icon name="drafts" className={s.navIcon} />
                <span>Drafts</span>
              </button>
              <button type="button" className={navClass({ type: "sent" })} onClick={() => navigate({ type: "sent" })}>
                <Icon name="send" className={s.navIcon} />
                <span>Sent</span>
              </button>
              <button type="button" className={navClass({ type: "reminders" })} onClick={() => navigate({ type: "reminders" })}>
                <Icon name="notifications" className={s.navIcon} />
                <span>Reminders</span>
              </button>
              <button type="button" className={unsupportedClass} disabled title="Coming later">
                <Icon name="delete" className={s.navIcon} />
                <span>Trash</span>
              </button>
              <button type="button" className={unsupportedClass} disabled title="Coming later">
                <Icon name="report" className={s.navIcon} />
                <span>Spam</span>
              </button>
              <button type="button" className={unsupportedClass} disabled title="Coming later">
                <Icon name="contacts" className={s.navIcon} />
                <span>Contacts</span>
              </button>
            </div>

            <div className={s.drawerGroup}>
              <div className={s.drawerLabel}>Bundled in the inbox</div>
              {/* Trips lived in this list in real Inbox, even though each
                  trip bundles individually rather than as one slice. */}
              <button
                type="button"
                className={navClass({ type: "trips" })}
                onClick={() => navigate({ type: "trips" })}
              >
                <Icon name="travel" className={s.navIcon} style={{ color: TRIP_COLOR }} />
                <span>Trips</span>
              </button>
              {bundles.map(({ id, meta }) => (
                <button
                  type="button"
                  key={id}
                  className={navClass({ type: "bundle", category: id })}
                  onClick={() => navigate({ type: "bundle", category: id })}
                >
                  <Icon
                    name={meta.icon}
                    className={s.navIcon}
                    style={{ color: meta.color }}
                  />
                  <span>{meta.name}</span>
                </button>
              ))}
            </div>
          </nav>
        </aside>

        <main className={s.content}>
        {!hydrated && (
          <p className={s.emptyText}>Loading…</p>
        )}

        {hydrated && stream.threadCount === 0 && !syncing && (
          <p className={s.emptyText}>{emptyTextForView(activeView, pinnedOnly)}</p>
        )}

        {visibleStream.sections.map((group) => {
          const expandedBundleIdx = expandedKey && isGroupKey(expandedKey)
            ? group.items.findIndex((item) => groupKeyOf(item) === expandedKey)
            : -1;

          const renderItems = (items: StreamItem[]) =>
            items.map((item) =>
              item.type === "thread" ? (
                <ThreadRow
                  key={item.thread.id}
                  thread={item.thread}
                  isExpanded={expandedKey === `thread:${item.thread.id}`}
                  onToggle={() => toggleKey(`thread:${item.thread.id}`)}
                  expandedRef={expandedRef}
                />
              ) : item.type === "reminder" ? (
                <ReminderRow key={item.reminder.id} reminder={item.reminder} />
              ) : item.type === "trip" ? (
                <TripSliceRow
                  key={item.trip.id}
                  tripKey={`trip:${item.trip.id}`}
                  trip={item.trip}
                  threads={item.threads}
                  isOpen={false}
                  onToggle={toggleKey}
                  expandedRef={expandedRef}
                />
              ) : (
                <BundleSliceRow
                  key={item.category}
                  bundleKey={`bundle:${item.category}`}
                  category={item.category}
                  threads={item.threads}
                  isOpen={false}
                  onToggle={toggleKey}
                  expandedRef={expandedRef}
                />
              )
            );

          const openBundle = expandedBundleIdx >= 0
            ? group.items[expandedBundleIdx] as GroupItem
            : null;

          const expandedThreadIdx = !openBundle && expandedKey?.startsWith("thread:")
            ? group.items.findIndex(
                (item) => item.type === "thread" && expandedKey === `thread:${item.thread.id}`
              )
            : -1;

          return (
            <section key={group.label} className={s.section}>
              <div className={s.sectionHeader}>
                <SectionLabel>{group.label}</SectionLabel>
                {showDoneAll && canDoneSection(group.items) && (
                  <div className={s.sectionActions}>
                    {showDeleteActions && (
                      <button
                        onClick={() => sectionTrashAll(group.items)}
                        title="Delete all"
                        className={s.sectionActionBtn}
                      >
                        <Icon name="delete" className={s.sectionActionIcon} />
                      </button>
                    )}
                    <button
                      onClick={() => sectionDoneAll(group.items)}
                      title="Done all"
                      className={s.sectionActionBtn}
                    >
                      <Icon name="done_all" className={s.sectionActionIcon} />
                    </button>
                  </div>
                )}
              </div>
              <LayoutGroup>
                {openBundle ? (
                  <>
                    {expandedBundleIdx > 0 && (
                      <MotionSurface className={s.card}>
                        {renderItems(group.items.slice(0, expandedBundleIdx))}
                      </MotionSurface>
                    )}
                    {openBundle.type === "trip" ? (
                      <TripSliceRow
                        tripKey={`trip:${openBundle.trip.id}`}
                        trip={openBundle.trip}
                        threads={openBundle.threads}
                        isOpen={true}
                        onToggle={toggleKey}
                        expandedRef={expandedRef}
                        openThreadId={openBundleThreadId}
                        onOpenThreadChange={setOpenBundleThreadId}
                      />
                    ) : (
                      <BundleSliceRow
                        bundleKey={`bundle:${openBundle.category}`}
                        category={openBundle.category}
                        threads={openBundle.threads}
                        isOpen={true}
                        onToggle={toggleKey}
                        expandedRef={expandedRef}
                        openThreadId={openBundleThreadId}
                        onOpenThreadChange={setOpenBundleThreadId}
                      />
                    )}
                    {expandedBundleIdx < group.items.length - 1 && (
                      <MotionSurface className={s.card}>
                        {renderItems(group.items.slice(expandedBundleIdx + 1))}
                      </MotionSurface>
                    )}
                  </>
                ) : expandedThreadIdx >= 0 ? (
                  <>
                    {expandedThreadIdx > 0 && (
                      <MotionSurface className={s.card}>
                        {renderItems(group.items.slice(0, expandedThreadIdx))}
                      </MotionSurface>
                    )}
                    <MotionSurface className={s.expandedThread}>
                      <ThreadRow
                        thread={(group.items[expandedThreadIdx] as Extract<StreamItem, { type: "thread" }>).thread}
                        isExpanded={true}
                        onToggle={() => toggleKey(expandedKey!)}
                        expandedRef={expandedRef}
                      />
                    </MotionSurface>
                    {expandedThreadIdx < group.items.length - 1 && (
                      <MotionSurface className={s.card}>
                        {renderItems(group.items.slice(expandedThreadIdx + 1))}
                      </MotionSurface>
                    )}
                  </>
                ) : (
                  <MotionSurface className={s.card}>
                    {renderItems(group.items)}
                  </MotionSurface>
                )}
              </LayoutGroup>
            </section>
          );
        })}
        {hasMoreItems && (
          <div className={s.loadMoreWrap}>
            <button
              type="button"
              className={s.loadMoreBtn}
              onClick={() => setVisibleItemLimit((limit) => limit + STREAM_PAGE_SIZE)}
            >
              Load more
              <span className={s.loadMoreCount}>
                {visibleStream.visibleCount} of {visibleStream.totalCount}
              </span>
            </button>
          </div>
        )}
        {/*
          Only once everything already cached is on screen: the button above
          pages what NeoInbox has, this one goes back to the mailbox for older
          inbox mail that the scan window left alone.
        */}
        {!hasMoreItems && canLoadOlderMail && (
          <div className={s.loadMoreWrap}>
            <button
              type="button"
              className={s.loadMoreBtn}
              onClick={loadMoreInbox}
              disabled={loadingMoreInbox}
            >
              {loadingMoreInbox ? "Fetching older mail…" : "Fetch older mail"}
              <span className={s.loadMoreCount}>
                {inboxWindow?.skipped.toLocaleString()} older in this inbox
              </span>
            </button>
          </div>
        )}
        </main>
      </div>
      <Fab />
      <Toaster />
    </div>
  );
};

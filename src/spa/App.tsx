import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { LayoutGroup } from "framer-motion";
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
import { CATEGORIES, getCategoryMeta, visibleCategories } from "../shared/categories";
import { resolveThread } from "../shared/threading";
import type { MessageKey } from "../shared/messageKey";
import { scrollKeeper } from "./lib/scrollKeeper";
import { AboutDialog } from "./components/AboutDialog";
import { AccountSwitcher } from "./components/AccountSwitcher";
import { BundleSliceRow } from "./components/BundleSliceRow";
import { BundleManagerModal } from "./components/BundleManagerModal";
import { useBulkActions } from "./components/BulkActionConfirm";
import { EmptyState, InboxZero } from "./components/EmptyState";
import {
  DoneArchiveFooter,
  PastTripsFooter,
  SearchArchiveFooter,
  ThunderbirdSearchFooter,
} from "./components/ArchiveFooter";
import { Fab } from "./components/Fab";
import { SearchTermsContext } from "./components/Highlight";
import { Icon } from "./components/Icon";
import { ReminderRow } from "./components/ReminderRow";
import { SelectionBar } from "./components/SelectionBar";
import { MotionSurface } from "./components/Motion";
import { SearchSuggestions, SEARCH_SUGGESTIONS_ID, suggestionId } from "./components/SearchSuggestions";
import { SectionLabel } from "./components/SectionLabel";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { ThreadRow } from "./components/ThreadRow";
import { Toaster } from "./components/Toaster";
import { overlayIsOpen } from "./lib/overlays";
import { moveRowFocus } from "./lib/rowNavigation";
import { focusToggleAfterChange } from "./lib/toggleFocus";
import { useRovingFocus } from "./lib/useRovingFocus";
import { useSelection, visibleThreadIds } from "./lib/selection";
import { TRIP_COLOR, TripSliceRow } from "./components/TripSliceRow";
import { useKnownContacts } from "./lib/contacts";
import { isSameView, parseHashView, viewForTrips, viewHash } from "./lib/routing";
import {
  recentSearches,
  rememberSearch,
  searchSuggestions,
  suggestionQuery,
  type SearchSuggestion,
} from "./lib/searchSuggestions";
import { searchTerms } from "../store/search";
import { openThunderbirdContacts, openThunderbirdFolder } from "./lib/thunderbirdViews";
import s from "./App.module.css";

const STREAM_PAGE_SIZE = 80;

/** App bar color while conversations are selected, whatever the view's own. */
const SELECTION_HEADER_COLOR = "#5f6368";

/** Fewer results than this and search offers to bring in older archived mail. */
const FEW_SEARCH_RESULTS = 5;

/** How long typing has to pause before search goes back to Dexie for older mail. */
const SEARCH_DEBOUNCE_MS = 250;


/** What an empty view shows; null for the inbox, which gets its sunny sky. */
const emptyStateForView = (
  view: StreamView,
  pinnedOnly: boolean,
  customBundles: ReturnType<typeof useMailStore.getState>["customBundles"],
): { icon: string; color?: string; title: string; hint?: string } | null => {
  if (view.type === "inbox")
    return pinnedOnly
      ? { icon: "push_pin", title: "Nothing pinned", hint: "Pin a conversation to keep it here." }
      : null;
  if (view.type === "snoozed") return { icon: "schedule", title: "Nothing snoozed" };
  if (view.type === "draft") return { icon: "drafts", title: "No drafts" };
  if (view.type === "sent") return { icon: "send", title: "No sent messages" };
  if (view.type === "done") return { icon: "done", title: "Nothing marked done" };
  if (view.type === "reminders")
    return {
      icon: "pan_tool_alt",
      title: "No reminders",
      hint: "Create one using the + button in the corner.",
    };
  if (view.type === "trips")
    return {
      icon: "travel",
      title: "No trips yet",
      hint: "Open a conversation and choose Move to → New trip.",
    };
  if (view.type === "bundle") {
    const meta = getCategoryMeta(view.category, customBundles);
    return { icon: meta.icon, title: `Nothing in ${meta.name}` };
  }
  return { icon: "search", title: "No messages found", hint: "Try different words, or fewer of them." };
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
  if (view.type === "search") return { title: "Search", color: "#546E7A" };
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

/** Below this the drawer covers the stream rather than sitting beside it. */
const isOverlayDrawer = (): boolean => window.matchMedia("(max-width: 979px)").matches;

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
  const loadingOlderInbox = useMailStore(
    (st) => !!(st.inboxImport?.running || (st.tripScan?.running && st.tripScan.fromInbox)),
  );
  const openBundleSettings = useMailStore((st) => st.openBundleSettings);
  const historyFrom = useMailStore((st) => st.historyFrom);
  const loadingHistory = useMailStore((st) => st.loadingHistory);
  const loadOlderHistory = useMailStore((st) => st.loadOlderHistory);
  const customBundles = useMailStore((st) => st.customBundles);

  const { doneMessages } = useBulkActions();

  // Bulk sweeps never touch pinned threads — that's the point of pinning.
  const sectionDoneAll = (items: StreamItem[]) => {
    const ids = items.flatMap((item) =>
      threadsOfItem(item)
        .filter((t) => !t.pinned)
        .flatMap((t) => t.messages.filter((m) => m.origin === "inbox").map((m) => m.key)),
    );
    doneMessages(ids);
  };

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [openBundleThreadId, setOpenBundleThreadId] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const sectionIdBase = useId();
  const contentRef = useRef<HTMLElement | null>(null);
  const bundleSettings = useBundleSettings();
  const closeBundleSettings = useMailStore((st) => st.closeBundleSettings);
  const [hashView, setHashView] = useState<StreamView>(parseHashView);
  const tripsEnabled = useMailStore((st) => st.tripsEnabled);
  const activeView = useMemo(() => viewForTrips(hashView, tripsEnabled), [hashView, tripsEnabled]);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const stream = useStreamForView(activeView, pinnedOnly);
  const [visibleItemLimit, setVisibleItemLimit] = useState(STREAM_PAGE_SIZE);
  const [drawerOpen, setDrawerOpen] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 980px)").matches,
  );
  const drawerRef = useRef<HTMLElement | null>(null);
  const drawerToggleRef = useRef<HTMLButtonElement | null>(null);
  const navKeyDown = useRovingFocus(drawerRef);
  // Closing hides the drawer from focus (it goes inert), so focus inside it
  // goes back to the menu button rather than falling to <body>.
  const closeDrawer = useCallback(() => {
    if (drawerRef.current?.contains(document.activeElement)) drawerToggleRef.current?.focus();
    setDrawerOpen(false);
  }, []);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const goPrefixRef = useRef(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [searchText, setSearchText] = useState(() =>
    activeView.type === "search" ? activeView.query : "",
  );
  // Where clearing a search goes back to.
  const lastBrowseViewRef = useRef<StreamView>({ type: "inbox" });
  const search = useMailStore((st) => st.search);
  const searchMail = useMailStore((st) => st.searchMail);
  const importingArchive = !!useMailStore((st) => st.archiveImport?.running);
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [recent, setRecent] = useState(recentSearches);
  const contacts = useKnownContacts(1000, searchFocused);
  const suggestions = useMemo(
    () => (searchFocused ? searchSuggestions(searchText, contacts, recent) : []),
    [searchFocused, searchText, contacts, recent],
  );
  const showSuggestions = suggestions.length > 0;
  const selectedIds = useSelection((st) => st.ids);
  const clearSelection = useSelection((st) => st.clear);
  const retainSelection = useSelection((st) => st.retain);

  useEffect(() => {
    void init();
  }, [init]);

  // Another account is another mailbox: nothing open or selected carries over.
  const accountFilter = useMailStore((st) => st.accountFilter);
  const shownAccountFilter = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!hydrated) return;
    const previous = shownAccountFilter.current;
    shownAccountFilter.current = accountFilter;
    // The filter hydration sets is where NeoInbox opens, not a switch.
    if (previous === undefined || previous === accountFilter) return;
    useSelection.getState().clear();
    scrollKeeper.release();
    setExpandedKey(null);
    setOpenBundleThreadId(null);
    setVisibleItemLimit(STREAM_PAGE_SIZE);
    window.scrollTo(0, 0);
  }, [hydrated, accountFilter]);

  useEffect(() => {
    const onHashChange = () => {
      const view = parseHashView();
      setHashView(view);
      setSearchText(view.type === "search" ? view.query : "");
      useSelection.getState().clear();
      scrollKeeper.release();
      setExpandedKey(null);
      setOpenBundleThreadId(null);
      setVisibleItemLimit(STREAM_PAGE_SIZE);
    };
    window.addEventListener("hashchange", onHashChange);
    onHashChange();
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (activeView.type !== "search") lastBrowseViewRef.current = activeView;
  }, [activeView]);

  // The stream narrows to what's in memory as you type; once typing pauses,
  // older matches are read in from Dexie. An archive import just finished
  // may have brought in more.
  const searchQuery = activeView.type === "search" ? activeView.query : null;
  useEffect(() => {
    if (searchQuery === null) return;
    const timer = window.setTimeout(() => void searchMail(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchQuery, searchMail, importingArchive]);
  const searching = searchQuery !== null && (search?.query !== searchQuery || search.loading);
  const highlightTerms = useMemo(() => (searchQuery ? searchTerms(searchQuery) : []), [searchQuery]);

  // The scroll keeper holds the open conversation (or whatever's at the top of
  // the screen) in place as the stream changes around it.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    return scrollKeeper.install(content, () => headerRef.current?.getBoundingClientRect().bottom ?? 0);
  }, []);

  // Every open/close goes through here, so the scroll keeper can note where
  // the row is *before* the change: an opening card is held there and eased
  // into view, a closing one stays on screen.
  const changeOpen = (nextExpanded: string | null, nextBundleThread: string | null) => {
    if (nextExpanded !== expandedKey) {
      if (nextExpanded) scrollKeeper.reveal(nextBundleThread ? `thread:${nextBundleThread}` : nextExpanded);
      else if (expandedKey) scrollKeeper.hold(expandedKey);
    } else if (nextBundleThread !== openBundleThreadId) {
      if (nextBundleThread) scrollKeeper.reveal(`thread:${nextBundleThread}`);
      else if (openBundleThreadId) scrollKeeper.hold(`thread:${openBundleThreadId}`);
    }
    setExpandedKey(nextExpanded);
    setOpenBundleThreadId(nextBundleThread);
  };
  const setBundleThread = (id: string | null) => changeOpen(expandedKey, id);

  const toggleKey = (key: string) => changeOpen(expandedKey === key ? null : key, null);

  // Null is "not heard from the background yet", which is no more empty than
  // a scan in flight is.
  const syncSettled = !!sync?.done;
  const syncFailed = !!sync?.done && !!sync.error;
  const reconnecting = connectionState === "reconnecting";
  // Trips isn't listed with the bundles: like Google Inbox, it gets a
  // top-level drawer entry (each trip also rows up in the inbox on its own).
  // Turned off, Travel is listed as a bundle in its place.
  const bundles = useMemo(
    () => [
      ...visibleCategories(Object.keys(CATEGORIES), tripsEnabled).filter(
        (category) => category !== "personal",
      ),
      ...customBundles.map((bundle) => bundle.id),
    ].map((category) => ({
      id: category,
      meta: getCategoryMeta(category, customBundles),
    })),
    [customBundles, tripsEnabled],
  );
  // Stable so the global key listener below isn't torn down and re-added on
  // every render of the stream.
  const navigate = useCallback((view: StreamView) => {
    scrollKeeper.release();
    setExpandedKey(null);
    setOpenBundleThreadId(null);
    if (typeof window !== "undefined") {
      const nextHash = viewHash(view);
      if (window.location.hash === nextHash) setHashView(view);
      else window.location.hash = nextHash;
      if (isOverlayDrawer()) closeDrawer();
    } else {
      setHashView(view);
    }
  }, [closeDrawer]);
  /** Empty the box, and leave the results for wherever search was started from. */
  const cancelSearch = () => {
    setSearchText("");
    setActiveSuggestion(-1);
    if (activeView.type === "search") navigate(lastBrowseViewRef.current);
  };
  const runSearch = (text: string) => {
    const query = text.trim();
    if (!query) return;
    setSearchText(query);
    setRecent(rememberSearch(query));
    // Off the box, so j/k and the row shortcuts work on the results.
    searchRef.current?.blur();
    navigate({ type: "search", query });
  };
  const pickSuggestion = (item: SearchSuggestion) => runSearch(suggestionQuery(item));

  // List-wide keys. Row-scoped ones (e/s/p/#) are handled by the focused row so
  // they always act on what the cursor is actually on.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (overlayIsOpen()) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a") {
        // Selects conversations instead of the page's text.
        e.preventDefault();
        useSelection.getState().selectAll(visibleThreadIds());
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

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

      // Lists with arrow keys of their own, like the drawer's views.
      const ownArrows = (e.target as HTMLElement).closest?.("[data-arrow-keys]");
      if (ownArrows && e.key.startsWith("Arrow")) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        if (moveRowFocus(1)) e.preventDefault();
      } else if (e.key === "k" || e.key === "ArrowUp") {
        if (moveRowFocus(-1)) e.preventDefault();
      } else if (e.key === "Escape") {
        if (drawerOpen && isOverlayDrawer()) closeDrawer();
        else if (useSelection.getState().ids.size > 0) useSelection.getState().clear();
        else if (openBundleThreadId) {
          focusToggleAfterChange(`thread:${openBundleThreadId}`);
          changeOpen(expandedKey, null);
        } else if (expandedKey) {
          focusToggleAfterChange(expandedKey);
          changeOpen(null, null);
        }
      } else if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts(true);
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
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
  }, [expandedKey, navigate, openBundleThreadId, drawerOpen, closeDrawer]);

  const navProps = (view: StreamView) => {
    const current = isSameView(activeView, view);
    return {
      className: `${s.navItem} ${current ? s.navItemActive : ""}`,
      "aria-current": current ? ("page" as const) : undefined,
    };
  };
  const showDoneAll = activeView.type === "inbox" || activeView.type === "bundle";
  const header =
    pinnedOnly && activeView.type === "inbox"
      ? { title: "Pinned", color: "var(--color-md-primary)" }
      : headerForView(activeView, customBundles);
  const emptyState = emptyStateForView(activeView, pinnedOnly, customBundles);
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

  // Thread ids change as threading learns more: opening a header-only row
  // fetches its References, which can join it to earlier mail, and search
  // reads in older matches. The open conversation is followed by its
  // messages (as of the last commit) to wherever it now lives.
  const openThreadId =
    openBundleThreadId ?? (expandedKey?.startsWith("thread:") ? expandedKey.slice("thread:".length) : null);
  const openThreadKeys = useRef<readonly MessageKey[]>([]);
  const openThread = openThreadId
    ? resolveThread(streamThreads, { id: openThreadId, keys: openThreadKeys.current })
    : undefined;
  useEffect(() => {
    openThreadKeys.current = openThread?.messages.map((m) => m.key) ?? [];
  }, [openThread]);
  if (openThreadId && openThread && openThread.id !== openThreadId) {
    // Adjusted during render so the card never commits closed. The scroll
    // keeper is told first, or it would take the old row's leaving the
    // stream for the card going away.
    scrollKeeper.rename(`thread:${openThreadId}`, `thread:${openThread.id}`);
    if (openBundleThreadId) setOpenBundleThreadId(openThread.id);
    else setExpandedKey(`thread:${openThread.id}`);
  }
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
  // Sent and Done load a page at a time (see store/history.ts); the views
  // that show them page further back from Dexie, no mailbox round-trip.
  const canLoadOlderHistory =
    historyFrom > 0 &&
    (activeView.type === "done" || activeView.type === "sent" || activeView.type === "bundle");

  // Done, Trips and a thin search end by offering mail that's still only in
  // the archive.
  const archiveFooter =
    searchQuery !== null ? (
      searching ? null : (
        <>
          {stream.threadCount < FEW_SEARCH_RESULTS && <SearchArchiveFooter />}
          <ThunderbirdSearchFooter query={searchQuery} />
        </>
      )
    ) : activeView.type === "done" && !canLoadOlderHistory ? (
      <DoneArchiveFooter />
    ) : activeView.type === "trips" && !canLoadOlderMail ? (
      <PastTripsFooter />
    ) : null;

  return (
    <div
      className={`${s.root} ${drawerOpen ? s.drawerOpen : ""}`}
      onClick={(e) => {
        if (!expandedKey) return;
        if (!(e.target as HTMLElement).closest("[data-row]")) {
          if (isGroupKey(expandedKey) && openBundleThreadId) {
            changeOpen(expandedKey, null);
            return;
          }

          changeOpen(null, null);
        }
      }}
    >
      {/* Past the header and drawer, which are a lot of Tab presses. */}
      <button
        type="button"
        className={s.skipLink}
        onClick={() => {
          if (!moveRowFocus(1)) contentRef.current?.focus();
        }}
      >
        Skip to conversations
      </button>
      {showShortcuts && <ShortcutsHelp onClose={() => setShowShortcuts(false)} />}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}

      {bundleSettings && (
        <BundleManagerModal
          onClose={closeBundleSettings}
          thread={bundleSettings.thread}
          initialCategory={bundleSettings.category}
          startNewBundle={bundleSettings.startNewBundle}
          highlightRuleId={bundleSettings.highlightRuleId}
          initialPane={bundleSettings.pane}
        />
      )}

      <header
        ref={headerRef}
        className={s.header}
        style={{ backgroundColor: selecting ? SELECTION_HEADER_COLOR : header.color }}
      >
        {selecting ? (
          <SelectionBar
            threads={selectedThreads}
            onClear={clearSelection}
          />
        ) : (
          <>
            <div className={s.headerLeft}>
              <button
                ref={drawerToggleRef}
                type="button"
                className={s.menuBtn}
                title={drawerOpen ? "Hide navigation" : "Show navigation"}
                aria-label={drawerOpen ? "Hide navigation" : "Show navigation"}
                aria-expanded={drawerOpen}
                onClick={() => {
                  if (drawerOpen) return closeDrawer();
                  setDrawerOpen(true);
                  // Covering the stream, the drawer is where you are now.
                  if (isOverlayDrawer()) {
                    requestAnimationFrame(() =>
                      drawerRef.current?.querySelector<HTMLElement>('button[tabindex="0"]')?.focus(),
                    );
                  }
                }}
              >
                <Icon name="menu" className={s.menuIcon} />
              </button>
              <h1 className={s.title}>{header.title}</h1>
            </div>
            <form
              role="search"
              className={s.search}
              onSubmit={(e) => {
                e.preventDefault();
                const picked = suggestions[activeSuggestion];
                if (picked) pickSuggestion(picked);
                else runSearch(searchText);
              }}
            >
              <label htmlFor="neo-search" className={s.searchIcon}>
                <Icon name="search" />
              </label>
              <input
                id="neo-search"
                ref={searchRef}
                type="search"
                className={s.searchInput}
                placeholder="Search"
                aria-label="Search mail"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showSuggestions}
                aria-controls={showSuggestions ? SEARCH_SUGGESTIONS_ID : undefined}
                aria-activedescendant={
                  showSuggestions && activeSuggestion >= 0 ? suggestionId(activeSuggestion) : undefined
                }
                autoComplete="off"
                value={searchText}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => {
                  setSearchFocused(false);
                  setActiveSuggestion(-1);
                }}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  setActiveSuggestion(-1);
                  // On the results already, they follow the typing; replacing
                  // the hash keeps every keystroke out of the back history.
                  const query = e.target.value.trim();
                  if (activeView.type !== "search" || !query) return;
                  const view: StreamView = { type: "search", query };
                  window.history.replaceState(null, "", viewHash(view));
                  setHashView(view);
                }}
                onKeyDown={(e) => {
                  if (showSuggestions && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                    e.preventDefault();
                    const step = e.key === "ArrowDown" ? 1 : -1;
                    // Wraps through "nothing picked" (-1), back to what's typed.
                    const count = suggestions.length + 1;
                    setActiveSuggestion((i) => ((i + 1 + step + count) % count) - 1);
                  } else if (e.key === "Escape") {
                    e.currentTarget.blur();
                    cancelSearch();
                  }
                }}
              />
              {(searchText || activeView.type === "search") && (
                <button
                  type="button"
                  className={s.searchClear}
                  aria-label="Clear search"
                  title="Clear search"
                  // Keep the box focused while typing; leaving the results blurs it.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (activeView.type === "search") searchRef.current?.blur();
                    else searchRef.current?.focus();
                    cancelSearch();
                  }}
                >
                  <Icon name="close" />
                </button>
              )}
              {showSuggestions && (
                <SearchSuggestions
                  text={searchText}
                  items={suggestions}
                  active={activeSuggestion}
                  onActiveChange={setActiveSuggestion}
                  onPick={pickSuggestion}
                />
              )}
            </form>
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
            <div className={s.headerRight}>
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
              <AccountSwitcher
                onShowShortcuts={() => setShowShortcuts(true)}
                onShowAbout={() => setShowAbout(true)}
              />
            </div>
          </>
        )}
      </header>

      <div className={s.appShell}>
        {drawerOpen && (
          <button
            type="button"
            className={s.drawerScrim}
            // For the pointer only: Escape closes the drawer from the keyboard.
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
        )}

        <aside
          ref={drawerRef}
          className={s.drawer}
          aria-label="Mailbox navigation"
          // Closed, it's only slid off screen; this takes it out of reach.
          inert={!drawerOpen}
          onBlur={(e) => {
            // Covering the stream, it closes once focus moves on, like a menu.
            const to = e.relatedTarget as Node | null;
            if (!to || !isOverlayDrawer()) return;
            if (drawerRef.current?.contains(to) || drawerToggleRef.current?.contains(to)) return;
            setDrawerOpen(false);
          }}
        >
          <nav className={s.drawerNav} data-arrow-keys onKeyDown={navKeyDown}>
            <div className={s.drawerGroup}>
              <button type="button" {...navProps({ type: "inbox" })} onClick={() => navigate({ type: "inbox" })}>
                <Icon name="inbox" className={s.navIcon} style={{ color: "#4285F4" }} />
                <span>Inbox</span>
              </button>
              <button type="button" {...navProps({ type: "snoozed" })} onClick={() => navigate({ type: "snoozed" })}>
                <Icon
                  name="schedule"
                  className={s.navIcon}
                  style={{ color: "#DF742C", fontVariationSettings: "'FILL' 0" }}
                />
                <span>Snoozed</span>
              </button>
              <button type="button" {...navProps({ type: "done" })} onClick={() => navigate({ type: "done" })}>
                <Icon name="done" className={s.navIcon} style={{ color: "#0F9D58" }} />
                <span>Done</span>
              </button>
            </div>

            <div className={s.drawerGroup}>
              <button type="button" {...navProps({ type: "draft" })} onClick={() => navigate({ type: "draft" })}>
                <Icon name="drafts" className={s.navIcon} />
                <span>Drafts</span>
              </button>
              <button type="button" {...navProps({ type: "sent" })} onClick={() => navigate({ type: "sent" })}>
                <Icon name="send" className={s.navIcon} />
                <span>Sent</span>
              </button>
              <button type="button" {...navProps({ type: "reminders" })} onClick={() => navigate({ type: "reminders" })}>
                <Icon name="pan_tool_alt" className={s.navIcon} />
                <span>Reminders</span>
              </button>
              <button type="button" className={`${s.navItem} ${s.navItemExternal}`} onClick={() => void openThunderbirdFolder("trash")} title="Opens in Thunderbird">
                <Icon name="delete" className={s.navIcon} />
                <span>Trash</span>
                <Icon name="open_in_new" className={s.navExternalIcon} />
              </button>
              <button type="button" className={`${s.navItem} ${s.navItemExternal}`} onClick={() => void openThunderbirdFolder("junk")} title="Opens in Thunderbird">
                <Icon name="report" className={s.navIcon} />
                <span>Spam</span>
                <Icon name="open_in_new" className={s.navExternalIcon} />
              </button>
              <button type="button" className={`${s.navItem} ${s.navItemExternal}`} onClick={() => void openThunderbirdContacts()} title="Opens in Thunderbird">
                <Icon name="contacts" className={s.navIcon} />
                <span>Contacts</span>
                <Icon name="open_in_new" className={s.navExternalIcon} />
              </button>
            </div>

            <div className={s.drawerGroup}>
              <div className={s.drawerLabel}>Bundled in the inbox</div>
              {/* Trips lived in this list in real Inbox, even though each
                  trip bundles individually rather than as one slice. */}
              {tripsEnabled && (
                <button
                  type="button"
                  {...navProps({ type: "trips" })}
                  onClick={() => navigate({ type: "trips" })}
                >
                  <Icon name="travel" className={s.navIcon} style={{ color: TRIP_COLOR }} />
                  <span>Trips</span>
                </button>
              )}
              {bundles.map(({ id, meta }) => (
                <button
                  type="button"
                  key={id}
                  {...navProps({ type: "bundle", category: id })}
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

        <SearchTermsContext.Provider value={highlightTerms}>
          <main ref={contentRef} className={s.content} tabIndex={-1}>
            {!hydrated && (
              <p className={s.emptyText}>Loading…</p>
            )}

            {hydrated && searching && stream.threadCount === 0 && (
              <p className={s.emptyText}>Searching…</p>
            )}

            {hydrated && stream.threadCount === 0 && syncSettled && !searching && (
              emptyState ? <EmptyState {...emptyState}>{archiveFooter}</EmptyState> : <InboxZero />
            )}

            {visibleStream.sections.map((group, groupIdx) => {
              const sectionLabelId = `${sectionIdBase}-section-${groupIdx}`;
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
                    />
                  ) : (
                    <BundleSliceRow
                      key={item.category}
                      bundleKey={`bundle:${item.category}`}
                      category={item.category}
                      threads={item.threads}
                      isOpen={false}
                      onToggle={toggleKey}
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
                    <SectionLabel id={sectionLabelId}>{group.label}</SectionLabel>
                    {showDoneAll && canDoneSection(group.items) && (
                      <div className={s.sectionActions}>
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
                  <div role="list" aria-labelledby={sectionLabelId} className={s.sectionList}>
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
                              openThreadId={openBundleThreadId}
                              onOpenThreadChange={setBundleThread}
                            />
                          ) : (
                            <BundleSliceRow
                              bundleKey={`bundle:${openBundle.category}`}
                              category={openBundle.category}
                              threads={openBundle.threads}
                              isOpen={true}
                              onToggle={toggleKey}
                              openThreadId={openBundleThreadId}
                              onOpenThreadChange={setBundleThread}
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
                          {/* Keyed per thread: reusing the previous card's element would
                            make framer fly it here from wherever that card was. */}
                          <MotionSurface key={expandedKey} className={s.expandedThread}>
                            <ThreadRow
                              thread={(group.items[expandedThreadIdx] as Extract<StreamItem, { type: "thread" }>).thread}
                              isExpanded={true}
                              onToggle={() => toggleKey(expandedKey!)}
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
                  </div>
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
            pages what NeoInbox has, this one is for older inbox mail the scan
            window left out. How far back is a choice, so it opens Settings →
            Older mail, which also shows the progress.
          */}
            {!hasMoreItems && canLoadOlderMail && (
              <div className={s.loadMoreWrap}>
                <button
                  type="button"
                  className={s.loadMoreBtn}
                  onClick={() => openBundleSettings({ pane: "archive" })}
                >
                  {loadingOlderInbox ? "Loading older mail…" : "Load older mail"}
                  <span className={s.loadMoreCount}>
                    {inboxWindow?.skipped.toLocaleString()} older{" "}
                    {inboxWindow?.skipped === 1 ? "message" : "messages"} not loaded
                  </span>
                </button>
              </div>
            )}
            {!hasMoreItems && canLoadOlderHistory && (
              <div className={s.loadMoreWrap}>
                <button
                  type="button"
                  className={s.loadMoreBtn}
                  onClick={() => void loadOlderHistory()}
                  disabled={loadingHistory}
                >
                  {loadingHistory ? "Loading older mail…" : "Show older mail"}
                  <span className={s.loadMoreCount}>
                    before {new Date(historyFrom).toLocaleDateString()}
                  </span>
                </button>
              </div>
            )}
            {/* Past the last cached row: offer what's still only in the archive. */}
            {hydrated && !hasMoreItems && stream.threadCount > 0 && archiveFooter}
          </main>
        </SearchTermsContext.Provider>
      </div>
      <Fab />
      <Toaster />
    </div>
  );
};

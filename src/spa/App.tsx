import { useEffect, useRef, useState } from "react";
import { LayoutGroup, useReducedMotion } from "framer-motion";
import {
  useConnectionState,
  useHydrated,
  useMailStore,
  useStream,
  useSyncProgress,
  type StreamItem,
} from "../store/mailStore";
import { BundleSliceRow } from "./components/BundleSliceRow";
import { BundleManagerModal } from "./components/BundleManagerModal";
import { Icon } from "./components/Icon";
import { MotionSurface } from "./components/Motion";
import { RowGroup } from "./components/RowGroup";
import { SectionLabel } from "./components/SectionLabel";
import { ThreadRow } from "./components/ThreadRow";
import { Toaster } from "./components/Toaster";
import s from "./App.module.css";


export const App = () => {
  const init = useMailStore((st) => st.init);
  const hydrated = useHydrated();
  const sync = useSyncProgress();
  const stream = useStream();
  const connectionState = useConnectionState();
  const retryBackfill = useMailStore((st) => st.retryBackfill);

  const doneThread = useMailStore((st) => st.doneThread);

  const sectionDoneAll = (items: StreamItem[]) => {
    const ids = items.flatMap((item) => {
      const threads = item.type === "thread" ? [item.thread] : item.threads;
      return threads.flatMap((t) =>
        t.messages.filter((m) => m.origin === "inbox").map((m) => m.id),
      );
    });
    doneThread(ids);
  };

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [openBundleThreadId, setOpenBundleThreadId] = useState<string | null>(null);
  const expandedRef = useRef<HTMLDivElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (expandedKey) {
      expandedRef.current?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "nearest",
      });
    }
  }, [expandedKey, reducedMotion]);

  const toggleKey = (key: string) => {
    setOpenBundleThreadId(null);
    setExpandedKey((prev) => (prev === key ? null : key));
  };

  const syncing = !!sync && !sync.done;
  const syncFailed = !!sync?.done && !!sync.error;
  const reconnecting = connectionState === "reconnecting";

  return (
    <div
      className={s.root}
      onClick={(e) => {
        if (!expandedKey) return;
        if (!(e.target as HTMLElement).closest("[data-row]")) {
          if (expandedKey.startsWith("bundle:") && openBundleThreadId) {
            setOpenBundleThreadId(null);
            return;
          }

          setExpandedKey(null);
        }
      }}
    >
      {settingsOpen && <BundleManagerModal onClose={() => setSettingsOpen(false)} />}

      <header className={s.header}>
        <h1 className={s.title}>NeoInbox</h1>
        <div className={s.headerRight}>
          {syncing && sync && (
            <span className={s.syncText}>
              Syncing… {sync.tagged}/{sync.scanned}
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
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            className={s.settingsBtn}
          >
            <Icon name="settings" className={s.settingsIcon} />
          </button>
        </div>
      </header>

      <div className={s.content}>
        {!hydrated && (
          <p className={s.emptyText}>Loading…</p>
        )}

        {hydrated && stream.threadCount === 0 && !syncing && (
          <p className={s.emptyText}>No messages found.</p>
        )}

        {stream.pinned.length > 0 && (
          <section className={s.section}>
            <div className={s.sectionLabelWrap}>
              <SectionLabel>Pinned</SectionLabel>
            </div>
            <LayoutGroup>
              {(() => {
                const expandedPinnedIdx = expandedKey?.startsWith("thread:")
                  ? stream.pinned.findIndex((t) => expandedKey === `thread:${t.id}`)
                  : -1;
                if (expandedPinnedIdx >= 0) {
                  const expanded = stream.pinned[expandedPinnedIdx]!;
                  return (
                    <>
                      {expandedPinnedIdx > 0 && (
                        <RowGroup layoutId="pinned-before">
                          {stream.pinned.slice(0, expandedPinnedIdx).map((t) => (
                            <ThreadRow
                              key={t.id}
                              thread={t}
                              isExpanded={false}
                              onToggle={() => toggleKey(`thread:${t.id}`)}
                              expandedRef={expandedRef}
                            />
                          ))}
                        </RowGroup>
                      )}
                      <MotionSurface className={s.expandedThread}>
                        <ThreadRow
                          key={expanded.id}
                          thread={expanded}
                          isExpanded={true}
                          onToggle={() => toggleKey(`thread:${expanded.id}`)}
                          expandedRef={expandedRef}
                        />
                      </MotionSurface>
                      {expandedPinnedIdx < stream.pinned.length - 1 && (
                        <RowGroup layoutId="pinned-after">
                          {stream.pinned.slice(expandedPinnedIdx + 1).map((t) => (
                            <ThreadRow
                              key={t.id}
                              thread={t}
                              isExpanded={false}
                              onToggle={() => toggleKey(`thread:${t.id}`)}
                              expandedRef={expandedRef}
                            />
                          ))}
                        </RowGroup>
                      )}
                    </>
                  );
                }
                return (
                  <RowGroup>
                    {stream.pinned.map((t) => (
                      <ThreadRow
                        key={t.id}
                        thread={t}
                        isExpanded={expandedKey === `thread:${t.id}`}
                        onToggle={() => toggleKey(`thread:${t.id}`)}
                        expandedRef={expandedRef}
                      />
                    ))}
                  </RowGroup>
                );
              })()}
            </LayoutGroup>
          </section>
        )}

        {stream.sections.map((group) => {
          const expandedBundleIdx = expandedKey?.startsWith("bundle:")
            ? group.items.findIndex(
                (item) => item.type === "bundle" && expandedKey === `bundle:${item.category}`
              )
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
            ? group.items[expandedBundleIdx] as Extract<StreamItem, { type: "bundle" }>
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
                <button
                  onClick={() => sectionDoneAll(group.items)}
                  title="Done all"
                  className={s.doneAllBtn}
                >
                  <Icon name="done_all" className={s.doneAllIcon} />
                </button>
              </div>
              <LayoutGroup>
                {openBundle ? (
                  <>
                    {expandedBundleIdx > 0 && (
                      <MotionSurface className={s.card}>
                        {renderItems(group.items.slice(0, expandedBundleIdx))}
                      </MotionSurface>
                    )}
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
      </div>
      <Toaster />
    </div>
  );
};

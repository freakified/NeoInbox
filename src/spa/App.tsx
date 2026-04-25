import { useEffect, useRef, useState } from "react";
import { LayoutGroup } from "framer-motion";
import {
  useHydrated,
  useMailStore,
  useStream,
  useSyncProgress,
  type StreamItem,
} from "../store/mailStore";
import { BundleSliceRow } from "./components/BundleSliceRow";
import { Icon } from "./components/Icon";
import { SectionLabel } from "./components/SectionLabel";
import { SettingsPanel } from "./components/SettingsPanel";
import { ThreadRow } from "./components/ThreadRow";

export const App = () => {
  const init = useMailStore((s) => s.init);
  const hydrated = useHydrated();
  const sync = useSyncProgress();
  const stream = useStream();

  const doneThread = useMailStore((s) => s.doneThread);

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
  const expandedRef = useRef<HTMLDivElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (expandedKey) {
      expandedRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [expandedKey]);

  const toggleKey = (key: string) =>
    setExpandedKey((prev) => (prev === key ? null : key));

  const syncing = sync && !sync.done;

  return (
    <div
      className="min-h-screen bg-md-background"
      onClick={(e) => {
        if (!expandedKey) return;
        if (!(e.target as HTMLElement).closest("[data-row]")) {
          setExpandedKey(null);
        }
      }}
    >
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      <header className="sticky top-0 z-20 bg-md-primary shadow-elevation-2 px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-medium text-white tracking-wide">NeoInbox</h1>
        <div className="flex items-center gap-3">
          {syncing && (
            <span className="text-sm text-white/80">
              Syncing… {sync.tagged}/{sync.scanned}
            </span>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            title="Bundle settings"
            className="text-white/80 hover:text-white"
          >
            <Icon name="settings" className="text-xl" />
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto py-6 px-8">
        {!hydrated && (
          <p className="text-md-secondary-text text-sm">Loading…</p>
        )}

        {hydrated && stream.threadCount === 0 && !syncing && (
          <p className="text-md-secondary-text text-sm">No messages found.</p>
        )}

        {stream.pinned.length > 0 && (
          <section className="mb-6">
            <div className="max-w-3xl mx-auto">
              <SectionLabel>Pinned</SectionLabel>
            </div>
            <LayoutGroup>
              <div className="flex flex-col">
                {stream.pinned.map((t) => (
                  <ThreadRow
                    key={t.id}
                    thread={t}
                    isExpanded={expandedKey === `thread:${t.id}`}
                    onToggleExpand={() => toggleKey(`thread:${t.id}`)}
                    expandedRef={expandedRef}
                  />
                ))}
              </div>
            </LayoutGroup>
          </section>
        )}

        {stream.sections.map((group) => (
          <section key={group.label} className="mb-6">
            <div className="max-w-3xl mx-auto flex items-center justify-between pr-1">
              <SectionLabel>{group.label}</SectionLabel>
              <button
                onClick={() => sectionDoneAll(group.items)}
                title="Done all"
                className="text-md-secondary-text hover:text-md-on-surface -mt-2"
              >
                <Icon name="done_all" className="text-xl" />
              </button>
            </div>
            <LayoutGroup>
              <div className="flex flex-col">
                {group.items.map((item) =>
                  item.type === "thread" ? (
                    <ThreadRow
                      key={item.thread.id}
                      thread={item.thread}
                      isExpanded={expandedKey === `thread:${item.thread.id}`}
                      onToggleExpand={() =>
                        toggleKey(`thread:${item.thread.id}`)
                      }
                      expandedRef={expandedRef}
                    />
                  ) : (
                    <BundleSliceRow
                      key={item.category}
                      bundleKey={`bundle:${item.category}`}
                      category={item.category}
                      threads={item.threads}
                      isOpen={expandedKey === `bundle:${item.category}`}
                      onToggle={toggleKey}
                      expandedRef={expandedRef}
                    />
                  ),
                )}
              </div>
            </LayoutGroup>
          </section>
        ))}
      </div>
    </div>
  );
}

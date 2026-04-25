import { useEffect, useRef, useState } from "react";
import { LayoutGroup } from "framer-motion";
import {
  useHydrated,
  useMailStore,
  useStream,
  useSyncProgress,
} from "../store/mailStore";
import { BundleSliceRow } from "./components/BundleSliceRow";
import { SectionLabel } from "./components/SectionLabel";
import { ThreadRow } from "./components/ThreadRow";

export const App = () => {
  const init = useMailStore((s) => s.init);
  const reclassify = useMailStore((s) => s.reclassify);
  const hydrated = useHydrated();
  const sync = useSyncProgress();
  const stream = useStream();

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const expandedRef = useRef<HTMLDivElement | null>(null);

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
      className="min-h-screen bg-neutral-100"
      onClick={(e) => {
        if (!expandedKey) return;
        if (!(e.target as HTMLElement).closest("[data-row]")) {
          setExpandedKey(null);
        }
      }}
    >
      <header className="sticky top-0 z-20 bg-white border-b border-neutral-200 px-4 py-2 flex items-center justify-between">
        <h1 className="text-lg font-semibold">NeoInbox</h1>
        <div className="flex items-center gap-3">
          {syncing && (
            <span className="text-xs text-neutral-500">
              Syncing… {sync.tagged}/{sync.scanned}
            </span>
          )}
          <button
            onClick={reclassify}
            className="text-sm px-3 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-50"
          >
            Re-classify
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto py-6 px-8">
        {!hydrated && (
          <p className="text-neutral-500 text-sm">Loading…</p>
        )}

        {hydrated && stream.threadCount === 0 && !syncing && (
          <p className="text-neutral-500 text-sm">No messages found.</p>
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
            <div className="max-w-3xl mx-auto">
              <SectionLabel>{group.label}</SectionLabel>
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

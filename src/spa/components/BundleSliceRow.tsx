import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Category, Thread } from "../../shared/types";
import { getCategoryMeta } from "../../shared/categories";
import { useMailStore, useCustomBundles } from "../../store/mailStore";
import { senderName } from "../lib/avatar";
import { groupByBucket } from "../lib/dateBucket";
import { BundleThreadCard } from "./BundleThreadCard";
import { Icon } from "./Icon";

export const BundleSliceRow = ({
  bundleKey,
  category,
  threads,
  isOpen,
  onToggle,
  expandedRef,
}: {
  bundleKey: string;
  category: Category;
  threads: Thread[];
  isOpen: boolean;
  onToggle: (key: string) => void;
  expandedRef: React.RefObject<HTMLDivElement | null>;
}) => {
  const customBundles = useCustomBundles();
  const meta = getCategoryMeta(category, customBundles);
  const doneThread = useMailStore((s) => s.doneThread);

  const unread = threads.reduce((n, t) => n + t.unreadCount, 0);
  const preview = threads
    .slice(0, 3)
    .map((t) => {
      const last = t.messages[t.messages.length - 1];
      return last ? senderName(last.author) : "";
    })
    .filter(Boolean)
    .join(" · ");

  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen) setOpenThreadId(null);
  }, [isOpen]);

  const toggleThread = (id: string) =>
    setOpenThreadId((prev) => (prev === id ? null : id));

  const handleDoneAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    for (const t of threads) {
      doneThread(
        t.messages.filter((m) => m.origin === "inbox").map((m) => m.id),
      );
    }
  };

  return (
    <motion.div
      layout
      data-row
      ref={isOpen ? expandedRef : undefined}
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      className={
        isOpen
          ? "w-full my-4 bg-neutral-200 rounded-xl overflow-hidden"
          : "w-full max-w-3xl mx-auto bg-white border-b border-md-divider last:border-b-0"
      }
    >
      {!isOpen && (
        <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-neutral-50">
          <button
            className="flex items-center gap-3 min-w-0 flex-1 text-left"
            onClick={() => onToggle(bundleKey)}
          >
            <Icon
              name={meta.icon}
              className="text-[22px] shrink-0"
              style={{ color: meta.color }}
            />
            <span
              className="font-medium text-sm shrink-0"
              style={{ color: meta.color }}
            >
              {meta.name}
            </span>
            {unread > 0 && (
              <span className="text-xs font-semibold text-md-on-surface shrink-0">
                ({unread})
              </span>
            )}
            <span className="text-sm text-md-secondary-text truncate min-w-0">
              {preview}
            </span>
          </button>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleDoneAll}
              title="Archive all"
              className="flex items-center gap-1 text-xs text-md-secondary-text hover:text-md-on-surface px-1.5 py-0.5 rounded hover:bg-neutral-100"
            >
              <Icon name="done_all" className="text-base" />
            </button>
            <button
              onClick={() => onToggle(bundleKey)}
              className="text-md-secondary-text hover:text-md-on-surface"
            >
              <Icon name="chevron_right" className="text-xl" />
            </button>
          </div>
        </div>
      )}

      {isOpen && (
        <div className="flex items-center justify-between px-5 py-4 bg-neutral-200">
          <button
            onClick={() => onToggle(bundleKey)}
            className="text-2xl font-medium hover:opacity-80"
            style={{ color: meta.color }}
          >
            {meta.name}
          </button>
          <div className="flex items-center gap-2 text-md-secondary-text">
            <button
              onClick={handleDoneAll}
              title="Archive all"
              className="flex items-center gap-1 text-sm hover:text-md-on-surface px-2 py-0.5 rounded hover:bg-neutral-100"
            >
              <Icon name="done_all" className="text-base" />
              Done all
            </button>
            <button
              onClick={() => onToggle(bundleKey)}
              className="hover:text-md-on-surface"
              title="Collapse"
            >
              <Icon name="expand_less" className="text-xl" />
            </button>
          </div>
        </div>
      )}

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="bg-neutral-200 px-5 pb-5">
              {groupByBucket(threads, (t) => t.latestDate).map(
                ({ label, items }) => (
                  <div key={label}>
                    <p className="text-sm text-md-secondary-text pt-4 pb-2 px-1">
                      {label}
                    </p>
                    <div className="flex flex-col gap-2">
                      {items.map((t) => (
                        <BundleThreadCard
                          key={t.id}
                          thread={t}
                          accentColor={meta.color}
                          isOpen={openThreadId === t.id}
                          onToggle={() => toggleThread(t.id)}
                        />
                      ))}
                    </div>
                  </div>
                ),
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

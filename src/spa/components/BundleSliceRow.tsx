import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Category, Thread } from "../../shared/types";
import { getCategoryMeta } from "../../shared/categories";
import { useMailStore, useCustomBundles } from "../../store/mailStore";
import { senderName } from "../lib/avatar";
import { formatDate, groupByBucket } from "../lib/dateBucket";
import { Icon } from "./Icon";
import { RowGroup } from "./RowGroup";
import { RowHeader } from "./RowHeader";
import { ThreadRow } from "./ThreadRow";

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
  const trashThread = useMailStore((s) => s.trashThread);

  const unread = threads.reduce((n, t) => n + t.unreadCount, 0);
  const latestDate = threads.reduce((max, t) => Math.max(max, t.latestDate), 0);
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
    const ids = threads.flatMap((t) =>
      t.messages.filter((m) => m.origin === "inbox").map((m) => m.id),
    );
    doneThread(ids);
  };

  const handleTrashAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    const ids = threads.flatMap((t) => t.messages.map((m) => m.id));
    trashThread(ids);
  };

  return (
    <motion.div
      layout
      data-row
      ref={isOpen ? expandedRef : undefined}
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      className={
        isOpen ? "w-full bg-neutral-200 overflow-hidden" : "w-full overflow-hidden"
      }
    >
      {!isOpen && (
        <RowHeader
          leading={
            <div className="w-9 h-9 flex items-center justify-center">
              <Icon
                name={meta.icon}
                className="text-[22px]"
                style={{ color: meta.color }}
              />
            </div>
          }
          primary={
            <>
              <span style={{ color: meta.color }} className="font-medium">
                {meta.name}
              </span>
              {unread > 0 && (
                <span className="text-xs font-semibold text-md-on-surface ml-1">
                  ({unread})
                </span>
              )}
            </>
          }
          secondary={preview}
          date={latestDate ? formatDate(latestDate) : undefined}
          onClick={() => onToggle(bundleKey)}
        />
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
          <div className="flex items-center gap-1 text-md-secondary-text">
            <button
              onClick={handleTrashAll}
              title="Delete all"
              className="hover:text-md-on-surface p-1 rounded hover:bg-neutral-100"
            >
              <Icon name="delete" className="text-xl" />
            </button>
            <button
              onClick={handleDoneAll}
              title="Archive all"
              className="hover:text-md-on-surface p-1 rounded hover:bg-neutral-100"
            >
              <Icon name="check" className="text-xl" />
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
            <div className="bg-neutral-200 pb-5">
              {groupByBucket(threads, (t) => t.latestDate).map(
                ({ label, items }) => (
                  <div key={label}>
                    <p className="text-sm text-md-secondary-text pt-4 pb-2 px-4">
                      {label}
                    </p>
                    <RowGroup>
                      {items.map((t) => (
                        <ThreadRow
                          key={t.id}
                          thread={t}
                          isExpanded={openThreadId === t.id}
                          onToggle={() => toggleThread(t.id)}
                        />
                      ))}
                    </RowGroup>
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

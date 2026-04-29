import { useEffect, useState } from "react";
import { clsx } from "clsx";
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
import s from "./BundleSliceRow.module.css";

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
  const doneThread = useMailStore((st) => st.doneThread);
  const trashThread = useMailStore((st) => st.trashThread);

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
    if (!isOpen) {
      setOpenThreadId(null);
    }
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
      className={clsx(s.slice, isOpen && s.sliceOpen)}
    >
      {!isOpen && (
        <RowHeader
          leading={
            <div className={s.iconWrap}>
              <Icon name={meta.icon} className={s.iconSized} style={{ color: meta.color }} />
            </div>
          }
          primary={
            <>
              <span style={{ color: meta.color }} className={s.bundleName}>
                {meta.name}
              </span>
              {unread > 0 && (
                <span className={s.unreadCount}>({unread})</span>
              )}
            </>
          }
          secondary={preview}
          date={latestDate ? formatDate(latestDate) : undefined}
          onClick={() => onToggle(bundleKey)}
        />
      )}

      {isOpen && (
        <div className={s.openHeader}>
          <button
            onClick={() => onToggle(bundleKey)}
            className={s.bundleTitle}
            style={{ color: meta.color }}
          >
            {meta.name}
          </button>
          <div className={s.actions}>
            <button
              onClick={handleTrashAll}
              title="Delete all"
              className={s.actionBtn}
            >
              <Icon name="delete" className={s.actionIcon} />
            </button>
            <button
              onClick={handleDoneAll}
              title="Archive all"
              className={s.actionBtn}
            >
              <Icon name="check" className={s.actionIcon} />
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
            className={s.expandBody}
          >
            <div className={s.expandInner}>
              {groupByBucket(threads, (t) => t.latestDate).map(
                ({ label, items }) => {
                  const spring = { type: "spring", stiffness: 500, damping: 40 } as const;
                  const expandedIdx = openThreadId
                    ? items.findIndex((t) => t.id === openThreadId)
                    : -1;
                  return (
                    <div key={label}>
                      <p className={s.bucketLabel}>{label}</p>
                      {expandedIdx >= 0 ? (
                        <>
                          {expandedIdx > 0 && (
                            <RowGroup layoutId={`${label}-before`}>
                              {items.slice(0, expandedIdx).map((t) => (
                                <ThreadRow
                                  key={t.id}
                                  thread={t}
                                  isExpanded={false}
                                  onToggle={() => toggleThread(t.id)}
                                />
                              ))}
                            </RowGroup>
                          )}
                          <motion.div layout transition={spring} className={s.expandedThread}>
                            <ThreadRow
                              key={items[expandedIdx]!.id}
                              thread={items[expandedIdx]!}
                              isExpanded={true}
                              onToggle={() => toggleThread(items[expandedIdx]!.id)}
                              expandedRef={expandedRef}
                            />
                          </motion.div>
                          {expandedIdx < items.length - 1 && (
                            <RowGroup layoutId={`${label}-after`}>
                              {items.slice(expandedIdx + 1).map((t) => (
                                <ThreadRow
                                  key={t.id}
                                  thread={t}
                                  isExpanded={false}
                                  onToggle={() => toggleThread(t.id)}
                                />
                              ))}
                            </RowGroup>
                          )}
                        </>
                      ) : (
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
                      )}
                    </div>
                  );
                },
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

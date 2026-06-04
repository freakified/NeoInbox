import { useEffect, useState } from "react";
import { clsx } from "clsx";
import type { Category, Thread } from "../../shared/types";
import { getCategoryMeta } from "../../shared/categories";
import { useCustomBundles } from "../../store/mailStore";
import { senderName } from "../lib/avatar";
import { formatDate, groupByBucket } from "../lib/dateBucket";
import { useBulkActions } from "./BulkActionConfirm";
import { Icon } from "./Icon";
import { MessageAttachments, collectAttachments } from "./MessageAttachments";
import { ExpandableRegion, MotionRow, MotionSurface } from "./Motion";
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
  openThreadId,
  onOpenThreadChange,
}: {
  bundleKey: string;
  category: Category;
  threads: Thread[];
  isOpen: boolean;
  onToggle: (key: string) => void;
  expandedRef: React.RefObject<HTMLDivElement | null>;
  openThreadId?: string | null;
  onOpenThreadChange?: (id: string | null) => void;
}) => {
  const customBundles = useCustomBundles();
  const meta = getCategoryMeta(category, customBundles);
  const { doneMessages, trashMessages } = useBulkActions();

  const threadCountLabel = threads.length > 25 ? "(25+)" : `(${threads.length})`;
  const latestDate = threads.reduce((max, t) => Math.max(max, t.latestDate), 0);
  const previewContent = threads
    .slice(0, 3)
    .map((t, idx) => {
      const last = t.messages[t.messages.length - 1];
      const name = last ? senderName(last.author) : "";
      if (!name) return null;
      return (
        <span key={t.id} className={clsx(t.unreadCount > 0 && s.unreadSender)}>
          {idx > 0 && " · "}
          {name}
        </span>
      );
    })
    .filter(Boolean);

  const preview = <span className={s.previewList}>{previewContent}</span>;
  const attachmentRefs = collectAttachments(threads.flatMap((t) => t.messages));

  const [localOpenThreadId, setLocalOpenThreadId] = useState<string | null>(null);
  const activeOpenThreadId = openThreadId !== undefined ? openThreadId : localOpenThreadId;
  const setOpenThreadId = onOpenThreadChange ?? setLocalOpenThreadId;

  useEffect(() => {
    if (!isOpen) {
      setOpenThreadId(null);
    }
  }, [isOpen, setOpenThreadId]);

  const toggleThread = (id: string) =>
    setOpenThreadId(activeOpenThreadId === id ? null : id);

  const handleDoneAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    const ids = threads.flatMap((t) =>
      t.messages.filter((m) => m.origin === "inbox").map((m) => m.id),
    );
    doneMessages(ids);
  };

  const handleTrashAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    const ids = threads.flatMap((t) => t.messages.map((m) => m.id));
    trashMessages(ids);
  };

  const handleBucketDoneAll = (bucketThreads: Thread[]) => (e: React.MouseEvent) => {
    e.stopPropagation();
    const ids = bucketThreads.flatMap((t) =>
      t.messages.filter((m) => m.origin === "inbox").map((m) => m.id),
    );
    doneMessages(ids);
  };

  const handleBucketTrashAll = (bucketThreads: Thread[]) => (e: React.MouseEvent) => {
    e.stopPropagation();
    const ids = bucketThreads.flatMap((t) => t.messages.map((m) => m.id));
    trashMessages(ids);
  };

  return (
    <MotionRow
      data-row
      ref={isOpen ? expandedRef : undefined}
      className={clsx(s.slice, isOpen && s.sliceOpen)}
      onClick={(e) => {
        if (!isOpen || !activeOpenThreadId) return;

        const target = e.target as HTMLElement;
        if (
          target.closest("[data-expanded-thread]") ||
          target.closest("[data-thread-row]")
        ) {
          return;
        }

        setOpenThreadId(null);
      }}
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
              <span className={s.threadCount}>{threadCountLabel}</span>
            </>
          }
          secondary={preview}
          trailing={
            attachmentRefs.length > 0 ? (
              <MessageAttachments
                attachments={attachmentRefs}
                compact
                limit={3}
              />
            ) : undefined
          }
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

      <ExpandableRegion
        isOpen={isOpen}
        className={s.expandBody}
        innerClassName={s.expandInner}
      >
        {groupByBucket(threads, (t) => t.latestDate).map(
          ({ label, items }) => {
            const expandedIdx = activeOpenThreadId
              ? items.findIndex((t) => t.id === activeOpenThreadId)
              : -1;
            const bucketKey = `${category}-${label}`;

            return (
              <div key={label}>
                <div className={s.bucketHeader}>
                  <p className={s.bucketLabel}>{label}</p>
                  <div className={s.actions}>
                    <button
                      onClick={handleBucketTrashAll(items)}
                      title="Delete all"
                      className={s.actionBtn}
                    >
                      <Icon name="delete" className={s.actionIcon} />
                    </button>
                    <button
                      onClick={handleBucketDoneAll(items)}
                      title="Done all"
                      className={s.actionBtn}
                    >
                      <Icon name="done_all" className={s.actionIcon} />
                    </button>
                  </div>
                </div>
                {expandedIdx >= 0 ? (
                  <>
                    {expandedIdx > 0 && (
                      <RowGroup layoutId={`${bucketKey}-before`} className={s.innerRows}>
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
                    <MotionSurface className={s.expandedThread} data-expanded-thread>
                      <ThreadRow
                        key={items[expandedIdx]!.id}
                        thread={items[expandedIdx]!}
                        isExpanded={true}
                        onToggle={() => toggleThread(items[expandedIdx]!.id)}
                        expandedRef={expandedRef}
                      />
                    </MotionSurface>
                    {expandedIdx < items.length - 1 && (
                      <RowGroup layoutId={`${bucketKey}-after`} className={s.innerRows}>
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
                  <RowGroup className={s.innerRows}>
                    {items.map((t) => (
                      <ThreadRow
                        key={t.id}
                        thread={t}
                        isExpanded={activeOpenThreadId === t.id}
                        onToggle={() => toggleThread(t.id)}
                      />
                    ))}
                  </RowGroup>
                )}
              </div>
            );
          },
        )}
      </ExpandableRegion>
    </MotionRow>
  );
};

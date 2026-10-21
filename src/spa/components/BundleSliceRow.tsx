import { useEffect, useId, useState } from "react";
import { clsx } from "clsx";
import type { Category, Thread } from "../../shared/types";
import { getCategoryMeta } from "../../shared/categories";
import { useCustomBundles, useMailStore } from "../../store/mailStore";
import { senderName } from "../lib/avatar";
import { countNewThreads, getBundleSeenAt, markBundleSeen, useBundleSeenAt } from "../lib/bundleSeen";
import { groupByBucket } from "../lib/dateBucket";
import { focusToggleAfterChange } from "../lib/toggleFocus";
import { useBulkActions } from "./BulkActionConfirm";
import { Icon } from "./Icon";
import { MessageAttachments, collectAttachments } from "./MessageAttachments";
import { ParcelCards, bundleHighlights } from "./ParcelCards";
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
  openThreadId,
  onOpenThreadChange,
}: {
  bundleKey: string;
  category: Category;
  threads: Thread[];
  isOpen: boolean;
  onToggle: (key: string) => void;
  openThreadId?: string | null;
  onOpenThreadChange?: (id: string | null) => void;
}) => {
  const customBundles = useCustomBundles();
  const meta = getCategoryMeta(category, customBundles);
  const { doneMessages, trashMessages } = useBulkActions();
  const openBundleSettings = useMailStore((st) => st.openBundleSettings);

  const seenAt = useBundleSeenAt(bundleKey);
  const newCount = countNewThreads(threads, seenAt);

  // Opening the bundle sees what's in it, as does closing it again, so mail
  // that lands while it's open isn't flagged afterwards. A bundle never seen
  // before starts from now rather than calling its whole backlog new.
  useEffect(() => {
    if (isOpen || getBundleSeenAt(bundleKey) === null) markBundleSeen(bundleKey);
    if (!isOpen) return;
    return () => markBundleSeen(bundleKey);
  }, [isOpen, bundleKey]);

  const threadCountLabel = threads.length > 25 ? "(25+)" : `(${threads.length})`;
  const senderNames = threads
    .slice(0, 3)
    .map((t) => {
      const last = t.messages[t.messages.length - 1];
      return last ? senderName(last.author) : "";
    })
    .filter(Boolean);
  const previewContent = threads
    .slice(0, 3)
    .map((t, idx) => {
      const last = t.messages[t.messages.length - 1];
      const name = last ? senderName(last.author) : "";
      if (!name) return null;
      return (
        <span key={t.id} className={clsx(t.unreadCount > 0 && s.unreadSender)}>
          {idx > 0 && ", "}
          {name}
        </span>
      );
    })
    .filter(Boolean);

  const preview = (
    <>
      {newCount > 0 && (
        <span
          className={s.newTag}
          style={{ "--bundle-color": meta.color } as React.CSSProperties}
        >
          {newCount} new
        </span>
      )}
      <span className={s.previewList}>{previewContent}</span>
    </>
  );
  const attachmentRefs = collectAttachments(threads.flatMap((t) => t.messages));
  const attachments = attachmentRefs.length > 0 && (
    <MessageAttachments attachments={attachmentRefs} compact limit={3} />
  );
  const highlights = bundleHighlights(threads);

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
  const toggleBundle = () => {
    focusToggleAfterChange(bundleKey);
    onToggle(bundleKey);
  };
  const id = useId();
  const bodyId = `${id}-body`;

  const handleDoneAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    const ids = threads.flatMap((t) =>
      t.messages.filter((m) => m.origin === "inbox").map((m) => m.key),
    );
    doneMessages(ids);
  };

  const handleTrashAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    const ids = threads.flatMap((t) => t.messages.map((m) => m.key));
    trashMessages(ids);
  };

  return (
    <MotionRow
      data-row
      data-row-key={bundleKey}
      className={clsx(s.slice, isOpen && s.sliceOpen)}
      role="listitem"
      onClick={(e) => {
        if (!isOpen || !activeOpenThreadId) return;

        const target = e.target as HTMLElement;
        if (
          target.closest("[data-expanded-thread]") ||
          target.closest("[data-thread-row]")
        ) {
          return;
        }

        focusToggleAfterChange(`thread:${activeOpenThreadId}`);
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
            highlights.length > 0 || attachmentRefs.length > 0 ? (
              <>
                {highlights.length > 0 ? (
                  // Attachments share the cards' line rather than wrapping below.
                  <ParcelCards parcels={highlights}>
                    {attachments}
                  </ParcelCards>
                ) : (
                  attachments
                )}
              </>
            ) : undefined
          }
          // "Forums(5)" reads as one word; say what the count is.
          label={[
            meta.name,
            threads.length > 25
              ? "more than 25 conversations"
              : `${threads.length} ${threads.length === 1 ? "conversation" : "conversations"}`,
            newCount > 0 && `${newCount} new`,
            senderNames.join(", "),
          ].filter(Boolean).join(", ")}
          onClick={toggleBundle}
          expanded={false}
          toggleKey={bundleKey}
        />
      )}

      {isOpen && (
        <div className={s.openHeader}>
          <h3 className={s.bundleHeading}>
            <button
              type="button"
              onClick={toggleBundle}
              className={s.bundleTitle}
              style={{ color: meta.color }}
              data-row-header=""
              data-row-toggle={bundleKey}
              aria-expanded={true}
              aria-controls={bodyId}
            >
              {meta.name}
            </button>
          </h3>
          <div className={s.actions}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                openBundleSettings({ category });
              }}
              title="Bundle settings"
              className={s.actionBtn}
            >
              <Icon name="settings" className={s.actionIcon} />
            </button>
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
        id={bodyId}
        isOpen={isOpen}
        className={s.expandBody}
        innerClassName={s.expandInner}
      >
        {groupByBucket(threads, (t) => t.latestDate).map(
          ({ label, items }, bucketIdx) => {
            const expandedIdx = activeOpenThreadId
              ? items.findIndex((t) => t.id === activeOpenThreadId)
              : -1;
            const bucketKey = `${category}-${label}`;
            const labelId = `${id}-bucket-${bucketIdx}`;

            return (
              <div key={label}>
                <div className={s.bucketHeader}>
                  <h4 id={labelId} className={s.bucketLabel}>{label}</h4>
                </div>
                <div role="list" aria-labelledby={labelId} className={s.bucketRows}>
                  {expandedIdx >= 0 ? (
                    <>
                      {expandedIdx > 0 && (
                        <RowGroup layoutId={`${bucketKey}-before`} className={clsx(s.innerRows, s.rowsBeforeOpen)}>
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
                      <MotionSurface key={items[expandedIdx]!.id} className={s.expandedThread} data-expanded-thread>
                        <ThreadRow
                          key={items[expandedIdx]!.id}
                          thread={items[expandedIdx]!}
                          isExpanded={true}
                          onToggle={() => toggleThread(items[expandedIdx]!.id)}
                          headingLevel={5}
                        />
                      </MotionSurface>
                      {expandedIdx < items.length - 1 && (
                        <RowGroup layoutId={`${bucketKey}-after`} className={clsx(s.innerRows, s.rowsAfterOpen)}>
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
              </div>
            );
          },
        )}
      </ExpandableRegion>
    </MotionRow>
  );
};

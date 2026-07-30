import { useEffect, useState } from "react";
import { clsx } from "clsx";
import type { Thread, TripRecord } from "../../shared/types";
import { formatTripRange, tripDateRange } from "../../shared/trips";
import { useMailStore } from "../../store/mailStore";
import { senderName } from "../lib/avatar";
import { useShowDeleteActions } from "../lib/deleteActionPrefs";
import { useBulkActions } from "./BulkActionConfirm";
import { Icon } from "./Icon";
import { ExpandableRegion, MotionRow, MotionSurface } from "./Motion";
import { RowGroup } from "./RowGroup";
import { RowHeader } from "./RowHeader";
import { ThreadRow } from "./ThreadRow";
import b from "./BundleSliceRow.module.css";
import s from "./TripSliceRow.module.css";

/** Google Inbox's trip blue. */
export const TRIP_COLOR = "#3F51B5";

export const TripSliceRow = ({
  tripKey,
  trip,
  threads,
  isOpen,
  onToggle,
  expandedRef,
  openThreadId,
  onOpenThreadChange,
}: {
  tripKey: string;
  trip: TripRecord;
  threads: Thread[];
  isOpen: boolean;
  onToggle: (key: string) => void;
  expandedRef: React.RefObject<HTMLDivElement | null>;
  openThreadId?: string | null;
  onOpenThreadChange?: (id: string | null) => void;
}) => {
  const renameTrip = useMailStore((st) => st.renameTrip);
  const deleteTrip = useMailStore((st) => st.deleteTrip);
  const showDeleteActions = useShowDeleteActions();
  const { doneMessages, trashMessages } = useBulkActions();

  const range = tripDateRange(trip, threads);
  const rangeLabel = range ? formatTripRange(range) : "";
  const latestDate = threads.reduce((max, t) => Math.max(max, t.latestDate), 0);

  const previewContent = threads
    .slice(0, 3)
    .map((t, idx) => {
      const last = t.messages[t.messages.length - 1];
      const name = last ? senderName(last.author) : "";
      if (!name) return null;
      return (
        <span key={t.id} className={clsx(t.unreadCount > 0 && b.unreadSender)}>
          {idx > 0 && " · "}
          {name}
        </span>
      );
    })
    .filter(Boolean);

  const [localOpenThreadId, setLocalOpenThreadId] = useState<string | null>(null);
  const activeOpenThreadId = openThreadId !== undefined ? openThreadId : localOpenThreadId;
  const setOpenThreadId = onOpenThreadChange ?? setLocalOpenThreadId;

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(trip.name);

  useEffect(() => {
    if (!isOpen) {
      setOpenThreadId(null);
      setEditing(false);
    }
  }, [isOpen, setOpenThreadId]);

  const toggleThread = (id: string) =>
    setOpenThreadId(activeOpenThreadId === id ? null : id);

  const commitRename = () => {
    setEditing(false);
    renameTrip(trip.id, draftName);
  };

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

  const expandedIdx = activeOpenThreadId
    ? threads.findIndex((t) => t.id === activeOpenThreadId)
    : -1;

  return (
    <MotionRow
      data-row
      ref={isOpen ? expandedRef : undefined}
      className={clsx(b.slice, isOpen && b.sliceOpen)}
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
            <div className={b.iconWrap}>
              <Icon name="travel" className={b.iconSized} style={{ color: TRIP_COLOR }} />
            </div>
          }
          primary={
            <>
              <span style={{ color: TRIP_COLOR }} className={b.bundleName}>
                {trip.name}
              </span>
              {threads.length > 0 && (
                <span className={b.threadCount}>({threads.length})</span>
              )}
            </>
          }
          secondary={
            previewContent.length > 0 ? (
              <span className={b.previewList}>{previewContent}</span>
            ) : (
              <span className={s.emptyPreview}>No mail in this trip yet</span>
            )
          }
          date={rangeLabel || undefined}
          onClick={() => onToggle(tripKey)}
        />
      )}

      {isOpen && (
        <div className={b.openHeader}>
          <div className={s.titleGroup}>
            {editing ? (
              <input
                type="text"
                autoFocus
                className={s.renameInput}
                value={draftName}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") {
                    setDraftName(trip.name);
                    setEditing(false);
                  }
                }}
              />
            ) : (
              <button
                onClick={() => onToggle(tripKey)}
                className={b.bundleTitle}
                style={{ color: TRIP_COLOR }}
              >
                {trip.name}
              </button>
            )}
            {rangeLabel && !editing && <span className={s.rangeLabel}>{rangeLabel}</span>}
          </div>
          <div className={b.actions}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDraftName(trip.name);
                setEditing(true);
              }}
              title="Rename trip"
              className={b.actionBtn}
            >
              <Icon name="edit" className={b.actionIcon} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteTrip(trip.id);
              }}
              title="Delete trip (mail stays in your inbox)"
              className={b.actionBtn}
            >
              <Icon name="delete" className={b.actionIcon} />
            </button>
            {showDeleteActions && threads.length > 0 && (
              <button
                onClick={handleTrashAll}
                title="Delete all"
                className={b.actionBtn}
              >
                <Icon name="delete_sweep" className={b.actionIcon} />
              </button>
            )}
            {threads.length > 0 && (
              <button
                onClick={handleDoneAll}
                title="Archive all"
                className={b.actionBtn}
              >
                <Icon name="check" className={b.actionIcon} />
              </button>
            )}
          </div>
        </div>
      )}

      <ExpandableRegion
        isOpen={isOpen}
        className={b.expandBody}
        innerClassName={b.expandInner}
      >
        {threads.length === 0 ? (
          <p className={s.emptyBody}>
            No mail in this trip yet. Open a conversation&rsquo;s ⋮ menu and choose Move to
            &rarr; this trip.
          </p>
        ) : expandedIdx >= 0 ? (
          <>
            {expandedIdx > 0 && (
              <RowGroup
                layoutId={`trip-${trip.id}-before`}
                className={clsx(b.innerRows, b.rowsBeforeOpen)}
              >
                {threads.slice(0, expandedIdx).map((t) => (
                  <ThreadRow
                    key={t.id}
                    thread={t}
                    isExpanded={false}
                    onToggle={() => toggleThread(t.id)}
                  />
                ))}
              </RowGroup>
            )}
            <MotionSurface className={b.expandedThread} data-expanded-thread>
              <ThreadRow
                key={threads[expandedIdx]!.id}
                thread={threads[expandedIdx]!}
                isExpanded={true}
                onToggle={() => toggleThread(threads[expandedIdx]!.id)}
                expandedRef={expandedRef}
              />
            </MotionSurface>
            {expandedIdx < threads.length - 1 && (
              <RowGroup
                layoutId={`trip-${trip.id}-after`}
                className={clsx(b.innerRows, b.rowsAfterOpen)}
              >
                {threads.slice(expandedIdx + 1).map((t) => (
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
          <RowGroup className={b.innerRows}>
            {threads.map((t) => (
              <ThreadRow
                key={t.id}
                thread={t}
                isExpanded={false}
                onToggle={() => toggleThread(t.id)}
              />
            ))}
          </RowGroup>
        )}
      </ExpandableRegion>
    </MotionRow>
  );
};

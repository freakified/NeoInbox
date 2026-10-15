import { useEffect, useState } from "react";
import { clsx } from "clsx";
import type { Thread, TripRecord } from "../../shared/types";
import { ITINERARY_ICONS, type ItineraryItem } from "../../shared/itinerary";
import { pinKeyOf } from "../../shared/pinKey";
import { formatTripRange, tripDateRange } from "../../shared/trips";
import { useMailStore } from "../../store/mailStore";
import { useShowDeleteActions } from "../lib/deleteActionPrefs";
import { useTripItinerary } from "../lib/useTripItinerary";
import { useBulkActions } from "./BulkActionConfirm";
import { Icon } from "./Icon";
import { ExpandableRegion, MotionRow, MotionSurface } from "./Motion";
import { RowGroup } from "./RowGroup";
import { RowHeader } from "./RowHeader";
import { ThreadRow } from "./ThreadRow";
import { TripArt } from "./TripArt";
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
  openThreadId,
  onOpenThreadChange,
}: {
  tripKey: string;
  trip: TripRecord;
  threads: Thread[];
  isOpen: boolean;
  onToggle: (key: string) => void;
  openThreadId?: string | null;
  onOpenThreadChange?: (id: string | null) => void;
}) => {
  const renameTrip = useMailStore((st) => st.renameTrip);
  const deleteTrip = useMailStore((st) => st.deleteTrip);
  const showDeleteActions = useShowDeleteActions();
  const { doneMessages, trashMessages } = useBulkActions();

  const range = tripDateRange(trip, threads);
  const rangeLabel = range ? formatTripRange(range) : "";

  const unread = threads.some((t) => t.unreadCount > 0);
  const itinerary = useTripItinerary(trip.id);

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

  const threadOfKey = (key: string): Thread | undefined =>
    threads.find((t) => t.messages.some((m) => pinKeyOf(m) === key));

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
      data-row-key={tripKey}
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
          primary={trip.name}
          bold={unread}
          secondary={
            <span className={s.card}>
              <TripArt tone="light" className={s.cardArt} />
              <span className={s.cardText}>
                <span className={s.cardName}>{trip.name}</span>
                {rangeLabel && <span>{rangeLabel}</span>}
              </span>
            </span>
          }
          onClick={() => onToggle(tripKey)}
          expanded={false}
        />
      )}

      {isOpen && (
        <div className={s.banner}>
          <TripArt tone="dark" className={s.bannerArt} />
          <div className={s.bannerContent}>
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
                <button onClick={() => onToggle(tripKey)} className={s.bannerTitle}>
                  {trip.name}
                </button>
              )}
              {rangeLabel && <span className={s.rangeLabel}>{rangeLabel}</span>}
            </div>
            <div className={s.bannerActions}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDraftName(trip.name);
                  setEditing(true);
                }}
                title="Rename trip"
                className={s.bannerBtn}
              >
                <Icon name="edit" className={b.actionIcon} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteTrip(trip.id);
                }}
                title="Delete trip (mail stays in your inbox)"
                className={s.bannerBtn}
              >
                <Icon name="delete" className={b.actionIcon} />
              </button>
              {showDeleteActions && threads.length > 0 && (
                <button onClick={handleTrashAll} title="Delete all" className={s.bannerBtn}>
                  <Icon name="delete_sweep" className={b.actionIcon} />
                </button>
              )}
              {threads.length > 0 && (
                <button onClick={handleDoneAll} title="Archive all" className={s.bannerBtn}>
                  <Icon name="check" className={b.actionIcon} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <ExpandableRegion
        isOpen={isOpen}
        className={b.expandBody}
        innerClassName={b.expandInner}
      >
        {itinerary.length > 0 && (
          <Itinerary
            items={itinerary}
            onOpen={(item) => {
              const thread = threadOfKey(item.sourceKey);
              if (thread) setOpenThreadId(thread.id);
            }}
            canOpen={(item) => threadOfKey(item.sourceKey) !== undefined}
          />
        )}
        {threads.length > 0 && (
          <div className={b.bucketHeader}>
            <h3 className={b.bucketLabel}>Related items</h3>
          </div>
        )}
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
            <MotionSurface key={threads[expandedIdx]!.id} className={b.expandedThread} data-expanded-thread>
              <ThreadRow
                key={threads[expandedIdx]!.id}
                thread={threads[expandedIdx]!}
                isExpanded={true}
                onToggle={() => toggleThread(threads[expandedIdx]!.id)}
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

const Itinerary = ({
  items,
  onOpen,
  canOpen,
}: {
  items: ItineraryItem[];
  onOpen: (item: ItineraryItem) => void;
  canOpen: (item: ItineraryItem) => boolean;
}) => (
  <div className={s.itinerary}>
    {items.map((item) => {
      const openable = canOpen(item);
      return (
        <button
          key={item.id}
          type="button"
          className={s.itineraryRow}
          disabled={!openable}
          title={openable ? "Open the email this came from" : undefined}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(item);
          }}
        >
          <Icon name={ITINERARY_ICONS[item.kind]} className={s.itineraryIcon} />
          <span className={s.itineraryText}>
            <span className={s.itineraryTitle}>{item.title}</span>
            <span className={s.itineraryWhen}>{item.when}</span>
          </span>
        </button>
      );
    })}
  </div>
);

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import type { Thread, TripRecord } from "../../shared/types";
import { ITINERARY_ICONS, itineraryMessage, type ItineraryItem } from "../../shared/itinerary";
import { formatTripRange, tripDateRange } from "../../shared/trips";
import { useMailStore } from "../../store/mailStore";
import { useTripItinerary } from "../lib/useTripItinerary";
import { useBulkActions } from "./BulkActionConfirm";
import { ErrorBoundary } from "./ErrorBoundary";
import { Icon } from "./Icon";
import { ExpandableRegion, MotionRow, MotionSurface } from "./Motion";
import { RowGroup } from "./RowGroup";
import { RowHeader } from "./RowHeader";
import { ThreadRow } from "./ThreadRow";
import { TripArt } from "./TripArt";
import b from "./BundleSliceRow.module.css";
import menu from "./BundleMenu.module.css";
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
  const startNewMessage = useMailStore((st) => st.startNewMessage);
  const moveToInboxThread = useMailStore((st) => st.moveToInboxThread);
  const notify = useMailStore((st) => st.notify);
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

  const commitRename = () => {
    setEditing(false);
    renameTrip(trip.id, draftName);
  };

  const handleDoneAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    const ids = threads.flatMap((t) =>
      t.messages.filter((m) => m.origin === "inbox").map((m) => m.key),
    );
    doneMessages(ids);
  };

  // Everything in the trip archived (snoozed mail still counts as inbox): the
  // check shows green, and clicking it brings the trip back.
  const messages = threads.flatMap((t) => t.messages);
  const isDone =
    messages.some((m) => m.origin === "done") && !messages.some((m) => m.origin === "inbox");

  const handleMoveToInbox = (e: React.MouseEvent) => {
    e.stopPropagation();
    moveToInboxThread(messages.filter((m) => m.origin === "done").map((m) => m.key));
    notify("Moved back to inbox");
  };

  const handleForward = (e: React.MouseEvent) => {
    e.stopPropagation();
    startNewMessage(itineraryMessage(trip.name, rangeLabel, itinerary));
  };

  // Inbox's trip Delete trashed everything in it, and the trip went with its
  // mail (see retireTrashedFromTrips) — there was no "delete the trip, keep
  // the mail" here; removing mail one conversation at a time does that.
  const handleTrashAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    const ids = threads.flatMap((t) => t.messages.map((m) => m.key));
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
              {itinerary.length > 0 && (
                <button onClick={handleForward} title="Forward itinerary" className={s.bannerBtn}>
                  <Icon name="forward" className={b.actionIcon} />
                </button>
              )}
              <button onClick={handleTrashAll} title="Delete" className={s.bannerBtn}>
                <Icon name="delete" className={b.actionIcon} />
              </button>
              {isDone ? (
                <button onClick={handleMoveToInbox} title="Move to inbox" className={s.bannerBtn}>
                  <Icon name="check" className={clsx(b.actionIcon, s.bannerIconDone)} />
                </button>
              ) : (
                <button onClick={handleDoneAll} title="Done" className={s.bannerBtn}>
                  <Icon name="check" className={b.actionIcon} />
                </button>
              )}
              <TripOverflowMenu
                onRename={() => {
                  setDraftName(trip.name);
                  setEditing(true);
                }}
              />
            </div>
          </div>
        </div>
      )}

      <ExpandableRegion
        isOpen={isOpen}
        className={b.expandBody}
        innerClassName={s.expandInner}
      >
        <ErrorBoundary scope="inline" label="trip">
          {itinerary.length > 0 && (
            <Itinerary items={itinerary} />
          )}
          {threads.length > 0 && (
            <div className={b.bucketHeader}>
              <h3 className={b.bucketLabel}>Related items</h3>
            </div>
          )}
          {expandedIdx >= 0 ? (
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
        </ErrorBoundary>
      </ExpandableRegion>
    </MotionRow>
  );
};

// Read-only: a line can merge several emails (booking, check-in, schedule
// change), so there's no one source to open.
const Itinerary = ({ items }: { items: ItineraryItem[] }) => (
  <div className={s.itinerary}>
    {items.map((item) => (
      <div key={item.id} className={s.itineraryRow}>
        <Icon name={ITINERARY_ICONS[item.kind]} className={s.itineraryIcon} />
        <span className={s.itineraryText}>
          <span className={s.itineraryTitle}>{item.title}</span>
          <span className={s.itineraryWhen}>{item.when}</span>
        </span>
      </div>
    ))}
  </div>
);

/** The banner's ⋮: where Inbox kept Rename. */
const TripOverflowMenu = ({ onRename }: { onRename: () => void }) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnScroll = () => setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        title="More"
        className={s.bannerBtn}
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
          setOpen(!open);
        }}
      >
        <Icon name="more_vert" className={b.actionIcon} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={menu.menu}
            style={position}
            role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={menu.menuItem}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onRename();
              }}
            >
              <Icon name="edit" className={menu.menuIcon} />
              <span className={menu.menuItemLabel}>Rename</span>
            </button>
          </div>,
          document.body,
        )}
    </>
  );
};

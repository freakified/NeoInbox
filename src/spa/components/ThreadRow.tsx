import { clsx } from "clsx";
import type { RawMessage, Thread } from "../../shared/types";
import { avatarColor, senderInitial, senderName } from "../lib/avatar";
import { formatDate, formatTimeAgo } from "../lib/dateBucket";
import { overlayIsOpen } from "../lib/overlays";
import { keepFocusAfterRowRemoval } from "../lib/rowNavigation";
import { useIsSelected, useSelection, useSelectionActive } from "../lib/selection";
import { formatSnoozeToastTime } from "../lib/snoozePresets";
import { useThreadActions } from "../lib/useThreadActions";
import { ActionStrip } from "./ActionStrip";
import { ErrorBoundary } from "./ErrorBoundary";
import { Icon } from "./Icon";
import { MessageAttachments, collectAttachments } from "./MessageAttachments";
import { FadeIn, MotionRow } from "./Motion";
import { ParcelCards, collectParcels } from "./ParcelCards";
import { RowHeader } from "./RowHeader";
import { ThreadView } from "./ThreadView";
import s from "./ThreadRow.module.css";

export const ThreadRow = ({
  thread: t,
  isExpanded,
  onToggle,
}: {
  thread: Thread;
  isExpanded: boolean;
  onToggle: () => void;
}) => {
  const actions = useThreadActions(t);
  const selected = useIsSelected(t.id);
  const selecting = useSelectionActive();
  const toggleSelected = useSelection((st) => st.toggle);
  const selectRange = useSelection((st) => st.selectRange);

  const select = (e?: React.MouseEvent) => {
    if (e?.shiftKey) selectRange(t.id);
    else toggleSelected(t.id);
  };

  // Row-scoped shortcuts. Enter/Space (open) are handled by RowHeader itself;
  // list-wide keys like j/k live in App.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // The snooze menu opens inside this row, so its keystrokes bubble here.
    if (overlayIsOpen()) return;

    const run = (enabled: boolean, action: () => void, removesRow = true) => {
      if (!enabled) return;
      e.preventDefault();
      if (removesRow) keepFocusAfterRowRemoval();
      action();
    };

    if (e.key === "e") run(actions.hasInboxMessages, actions.done);
    else if (e.key === "s") run(actions.hasInboxMessages, actions.snoozeDefault);
    else if (e.key === "#") run(true, actions.trash);
    else if (e.key === "p") run(true, actions.togglePin, false);
    else if (e.key === "x") run(true, () => toggleSelected(t.id), false);
  };

  const firstSender = t.messages[0];
  const name = firstSender ? senderName(firstSender.author) : "";
  const avatarBg = avatarColor(name);
  const initial = firstSender ? senderInitial(firstSender.author) : "?";
  const attachmentRefs = collectAttachments(t.messages);
  const parcels = collectParcels(t.messages);
  const hasDraft = t.messages.some((m) => m.origin === "draft");
  // Inbox's grey text after the subject: the newest message's own words.
  const snippet = t.messages.reduce<RawMessage | undefined>(
    (newest, m) => (m.snippet && (!newest || m.date >= newest.date) ? m : newest),
    undefined,
  )?.snippet;
  // Whole thread archived: bundle and done views mix these with inbox threads.
  const isDone =
    t.messages.some((m) => m.origin === "done") &&
    !t.messages.some((m) => m.origin === "inbox");
  // A resting snooze shows when it wakes in the date slot; once it has woken,
  // Inbox says so on a line under the subject instead.
  const snoozeInfo = t.snoozeDueAt ? (
    <span className={s.snoozeDue}>
      <span>{formatDate(t.snoozeDueAt)}</span>
      <Icon name="schedule" className={s.snoozeIcon} />
    </span>
  ) : null;
  const woke = !t.snoozeDueAt && t.resurfacedAt && t.snoozeExpired ? (
    <span title={`Snoozed until ${formatSnoozeToastTime(t.resurfacedAt)}`}>
      Snoozed {formatTimeAgo(t.resurfacedAt)}
    </span>
  ) : null;
  // Like Inbox, a closed row carries no timestamp (the section header dates
  // it); the slot only holds a resting snooze's wake time and the pin/done marks.
  const date = t.pinned || isDone ? (
    <span className={s.pinnedDate}>
      {isDone && <Icon name="check" className={s.doneIndicator} />}
      {snoozeInfo}
      {t.pinned && <Icon name="push_pin" className={s.pinIndicator} />}
    </span>
  ) : snoozeInfo;

  return (
    <MotionRow
      data-row
      data-thread-row
      data-thread-id={isExpanded ? undefined : t.id}
      data-row-key={`thread:${t.id}`}
      className={s.row}
    >
      {!isExpanded && (
        <RowHeader
          leading={
            // Google Inbox's affordance: the avatar turns into a checkbox on
            // hover, and every avatar shows one once anything is selected.
            <button
              type="button"
              tabIndex={-1}
              className={clsx(s.avatar, selecting && s.avatarSelecting, selected && s.avatarSelected)}
              style={{ "--avatar-bg": avatarBg } as React.CSSProperties}
              aria-label={selected ? "Deselect conversation" : "Select conversation"}
              aria-pressed={selected}
              onClick={(e) => {
                e.stopPropagation();
                select(e);
              }}
            >
              <span className={s.avatarInitial}>{initial}</span>
              <Icon name="check" className={s.avatarCheck} />
            </button>
          }
          primary={t.participantsLabel}
          secondary={
            <>
              {hasDraft && <span className={s.draftLabel}>Draft </span>}
              {t.subject || "(no subject)"}
              {snippet && <span className={s.snippet}> – {snippet}</span>}
            </>
          }
          subline={woke}
          trailing={
            parcels.length > 0 || attachmentRefs.length > 0 ? (
              <>
                {parcels.length > 0 && <ParcelCards parcels={parcels} />}
                {attachmentRefs.length > 0 && (
                  <MessageAttachments
                    attachments={attachmentRefs}
                    compact
                    limit={2}
                  />
                )}
              </>
            ) : undefined
          }
          date={date}
          bold={t.unreadCount > 0}
          // While selecting, a click anywhere on the row adds it to the
          // selection rather than opening it, and the per-row actions give way
          // to the selection bar's.
          onClick={selecting ? select : onToggle}
          onKeyDown={onKeyDown}
          expanded={false}
          selected={selected}
          actionStrip={selecting ? undefined : <ActionStrip thread={t} />}
        />
      )}
      {isExpanded && (
        <FadeIn>
          <ErrorBoundary scope="inline" label="conversation">
            <ThreadView thread={t} />
          </ErrorBoundary>
        </FadeIn>
      )}
    </MotionRow>
  );
};

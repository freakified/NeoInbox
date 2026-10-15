import { clsx } from "clsx";
import type { Thread } from "../../shared/types";
import { getCategoryMeta } from "../../shared/categories";
import { useCustomBundles } from "../../store/mailStore";
import { avatarColor, senderInitial, senderName } from "../lib/avatar";
import { formatDate } from "../lib/dateBucket";
import { useShowDeleteActions } from "../lib/deleteActionPrefs";
import { overlayIsOpen } from "../lib/overlays";
import { keepFocusAfterRowRemoval } from "../lib/rowNavigation";
import { useIsSelected, useSelection, useSelectionActive } from "../lib/selection";
import { formatSnoozeToastTime } from "../lib/snoozePresets";
import { useThreadActions } from "../lib/useThreadActions";
import { ActionStrip } from "./ActionStrip";
import { Icon } from "./Icon";
import { MessageAttachments, collectAttachments } from "./MessageAttachments";
import { FadeIn, MotionRow } from "./Motion";
import { RowHeader } from "./RowHeader";
import { ThreadView } from "./ThreadView";
import s from "./ThreadRow.module.css";

export const ThreadRow = ({
  thread: t,
  isExpanded,
  onToggle,
  expandedRef,
}: {
  thread: Thread;
  isExpanded: boolean;
  onToggle: () => void;
  expandedRef?: React.RefObject<HTMLDivElement | null>;
}) => {
  const customBundles = useCustomBundles();
  const actions = useThreadActions(t);
  const showDeleteActions = useShowDeleteActions();
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
    else if (e.key === "#") run(showDeleteActions, actions.trash);
    else if (e.key === "p") run(true, actions.togglePin, false);
    else if (e.key === "x") run(true, () => toggleSelected(t.id), false);
  };

  const firstSender = t.messages[0];
  const name = firstSender ? senderName(firstSender.author) : "";
  const avatarBg = avatarColor(name);
  const initial = firstSender ? senderInitial(firstSender.author) : "?";
  const attachmentRefs = collectAttachments(t.messages);
  const hasDraft = t.messages.some((m) => m.origin === "draft");
  // Whole thread archived: bundle and done views mix these with inbox threads.
  const isDone =
    t.messages.some((m) => m.origin === "done") &&
    !t.messages.some((m) => m.origin === "inbox");
  // A pinned thread escapes its bundle in the stream, so the chip keeps its origin visible.
  const bundleMeta = t.pinned && t.category ? getCategoryMeta(t.category, customBundles) : null;
  const baseDate = t.snoozeDueAt ? (
    <span className={s.snoozeDue}>
      <span>{formatDate(t.snoozeDueAt)}</span>
      <Icon name="schedule" className={s.snoozeIcon} />
    </span>
  ) : t.resurfacedAt ? (
    <span
      className={s.snoozeDue}
      title={`Snoozed until ${formatSnoozeToastTime(t.resurfacedAt)}`}
    >
      <span>{formatDate(t.resurfacedAt)}</span>
      <Icon name="schedule" className={s.snoozeIcon} />
    </span>
  ) : formatDate(t.latestDate);
  const date = t.pinned || isDone ? (
    <span className={s.pinnedDate}>
      {t.pinned && <Icon name="push_pin" className={s.pinIndicator} />}
      {isDone && <Icon name="check" className={s.doneIndicator} />}
      {baseDate}
    </span>
  ) : baseDate;

  return (
    <MotionRow
      data-row
      data-thread-row
      data-thread-id={isExpanded ? undefined : t.id}
      ref={isExpanded ? expandedRef : undefined}
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
              {bundleMeta && (
                <span className={s.bundleChip} style={{ color: bundleMeta.color }}>
                  {bundleMeta.name}
                </span>
              )}
              {hasDraft && <span className={s.draftLabel}>Draft </span>}
              {t.subject || "(no subject)"}
            </>
          }
          trailing={
            attachmentRefs.length > 0 ? (
              <MessageAttachments
                attachments={attachmentRefs}
                compact
                limit={2}
              />
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
          <ThreadView thread={t} />
        </FadeIn>
      )}
    </MotionRow>
  );
};

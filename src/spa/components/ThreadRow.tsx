import type { Thread } from "../../shared/types";
import { getCategoryMeta } from "../../shared/categories";
import { useCustomBundles } from "../../store/mailStore";
import { avatarColor, senderInitial, senderName } from "../lib/avatar";
import { formatDate } from "../lib/dateBucket";
import { formatSnoozeToastTime } from "../lib/snoozePresets";
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
      ref={isExpanded ? expandedRef : undefined}
      className={s.row}
    >
      {!isExpanded && (
        <RowHeader
          leading={
            <div className={s.avatar} style={{ backgroundColor: avatarBg }}>
              {initial}
            </div>
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
          onClick={onToggle}
          actionStrip={<ActionStrip thread={t} />}
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

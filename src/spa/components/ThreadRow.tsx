import type { Thread } from "../../shared/types";
import { avatarColor, senderInitial, senderName } from "../lib/avatar";
import { formatDate } from "../lib/dateBucket";
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
  const firstSender = t.messages[0];
  const name = firstSender ? senderName(firstSender.author) : "";
  const avatarBg = avatarColor(name);
  const initial = firstSender ? senderInitial(firstSender.author) : "?";
  const attachmentRefs = collectAttachments(t.messages);
  const hasDraft = t.messages.some((m) => m.origin === "draft");
  const date = t.snoozeDueAt ? (
    <span className={s.snoozeDue}>
      <span>{formatDate(t.snoozeDueAt)}</span>
      <Icon name="schedule" className={s.snoozeIcon} />
    </span>
  ) : formatDate(t.latestDate);

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
            hasDraft ? (
              <>
                <span className={s.draftLabel}>Draft</span> {t.subject || "(no subject)"}
              </>
            ) : (
              t.subject || "(no subject)"
            )
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

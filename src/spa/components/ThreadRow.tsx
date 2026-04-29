import type { Thread } from "../../shared/types";
import { avatarColor, senderInitial, senderName } from "../lib/avatar";
import { formatDate } from "../lib/dateBucket";
import { ActionStrip } from "./ActionStrip";
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
          secondary={t.subject || "(no subject)"}
          trailing={
            attachmentRefs.length > 0 ? (
              <MessageAttachments
                attachments={attachmentRefs}
                compact
                limit={2}
              />
            ) : undefined
          }
          date={formatDate(t.latestDate)}
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

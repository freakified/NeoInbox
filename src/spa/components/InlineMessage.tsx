import { clsx } from "clsx";
import type { RawMessage } from "../../shared/types";
import { avatarColor, senderInitial, senderName } from "../lib/avatar";
import { formatDate } from "../lib/dateBucket";
import { MessageBody } from "./MessageBody";
import { ExpandableRegion } from "./Motion";
import s from "./InlineMessage.module.css";

export const InlineMessage = ({
  message: m,
  isOpen,
  onToggle,
}: {
  message: RawMessage;
  isOpen: boolean;
  onToggle: () => void;
}) => {
  const name = senderName(m.author);
  const color = avatarColor(name);

  return (
    <div className={s.message}>
      <div
        className={s.header}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <div className={s.avatar} style={{ backgroundColor: color }}>
          {senderInitial(m.author)}
        </div>
        <div className={s.meta}>
          <span className={clsx(s.sender, !m.read && s.senderUnread)}>
            {m.origin === "sent" ? `${name} → ` : name}
          </span>
          <span className={s.date}>{formatDate(m.date)}</span>
        </div>
      </div>

      <ExpandableRegion isOpen={isOpen} className={s.bodyWrap}>
        <MessageBody message={m} />
      </ExpandableRegion>
    </div>
  );
};

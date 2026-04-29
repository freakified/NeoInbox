import { clsx } from "clsx";
import { useEffect, useState } from "react";
import type { RawMessage } from "../../shared/types";
import { avatarColor, senderInitial, senderName } from "../lib/avatar";
import { formatDate } from "../lib/dateBucket";
import { extractPreviewText } from "../lib/srcdoc";
import { MessageBody } from "./MessageBody";
import { ExpandableRegion } from "./Motion";
import s from "./InlineMessage.module.css";

export const InlineMessage = ({
  message: m,
  isOpen,
  onToggle,
  canToggle = true,
}: {
  message: RawMessage;
  isOpen: boolean;
  onToggle: () => void;
  canToggle?: boolean;
}) => {
  const name = senderName(m.author);
  const color = avatarColor(name);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen || preview !== null) return;

    let cancelled = false;
    messenger.messages
      .getFull(m.id)
      .then((part) => {
        if (!cancelled) setPreview(extractPreviewText(part));
      })
      .catch(() => {
        if (!cancelled) setPreview("");
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, m.id, preview]);

  return (
    <div className={s.message}>
      <div
        className={clsx(s.header, !canToggle && s.headerLocked)}
        onClick={(e) => {
          e.stopPropagation();
          if (canToggle) onToggle();
        }}
      >
        <div className={s.avatar} style={{ backgroundColor: color }}>
          {senderInitial(m.author)}
        </div>
        <div className={s.meta}>
          <div className={s.metaLine}>
            <span className={clsx(s.sender, !m.read && s.senderUnread)}>
              {m.origin === "sent" ? `${name} → ` : name}
            </span>
            <span className={s.date}>{formatDate(m.date)}</span>
          </div>
          {!isOpen && (
            <div className={s.preview}>
              {preview ?? "Loading message preview..."}
            </div>
          )}
          <ExpandableRegion
            isOpen={isOpen}
            className={s.bodyWrap}
            innerClassName={s.bodyInner}
          >
            <div
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <MessageBody message={m} />
            </div>
          </ExpandableRegion>
        </div>
      </div>
    </div>
  );
};

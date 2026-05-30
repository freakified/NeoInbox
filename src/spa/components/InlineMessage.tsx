import { clsx } from "clsx";
import { useEffect, useState } from "react";
import { parseSender } from "../../shared/senders";
import type { RawMessage } from "../../shared/types";
import { avatarColor, senderInitial, senderName } from "../lib/avatar";
import { formatDate } from "../lib/dateBucket";
import { extractPreviewText } from "../lib/srcdoc";
import { MessageAttachments } from "./MessageAttachments";
import { MessageBody } from "./MessageBody";
import { ExpandableRegion } from "./Motion";
import s from "./InlineMessage.module.css";

const displayAddressName = (raw: string): { name: string; email: string } => {
  const parsed = parseSender(raw);
  const email = parsed.email;
  const localPart = email.includes("@") ? parsed.localPart || email.split("@")[0] : "";
  return {
    name: parsed.name || localPart || raw,
    email,
  };
};

export const InlineMessage = ({
  message: m,
  isOpen,
  onToggle,
  canToggle = true,
  translationRequest = 0,
  onTranslatedSubject,
}: {
  message: RawMessage;
  isOpen: boolean;
  onToggle: () => void;
  canToggle?: boolean;
  translationRequest?: number;
  onTranslatedSubject?: (subject: string) => void;
}) => {
  const name = senderName(m.author);
  const sender = displayAddressName(m.author);
  const recipients = m.recipients.map(displayAddressName);
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
            {isOpen ? (
              <span className={s.addressLine}>
                <span className={s.senderOpen} title={sender.email}>
                  {sender.name}
                </span>
                {recipients.length > 0 && (
                  <>
                    <span className={s.toLabel}>to</span>
                    <span className={s.recipients}>
                      {recipients.map((recipient, index) => (
                        <span key={`${recipient.email}-${index}`}>
                          <span className={s.recipient} title={recipient.email}>
                            {recipient.name}
                          </span>
                          {index < recipients.length - 1 && ", "}
                        </span>
                      ))}
                    </span>
                  </>
                )}
              </span>
            ) : (
              <span className={clsx(s.sender, !m.read && s.senderUnread)}>
                {m.origin === "sent" ? `${name} → ` : name}
              </span>
            )}
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
              <MessageBody
                message={m}
                translationRequest={translationRequest}
                onTranslatedSubject={onTranslatedSubject}
              />
            </div>
          </ExpandableRegion>
          {m.attachments && m.attachments.length > 0 && (
            <MessageAttachments
              attachments={m.attachments.map((a) => ({
                messageId: m.id,
                attachment: a,
              }))}
              compact
            />
          )}
        </div>
      </div>
    </div>
  );
};

import { clsx } from "clsx";
import { useEffect, useState } from "react";
import { resolveLiveMessageId } from "../../shared/liveMessage";
import { parseSender } from "../../shared/senders";
import type { RawMessage } from "../../shared/types";
import { useMailStore } from "../../store/mailStore";
import { avatarColor, senderInitial, senderName } from "../lib/avatar";
import { formatDate } from "../lib/dateBucket";
import { extractPreviewText } from "../lib/srcdoc";
import { MessageAttachments } from "./MessageAttachments";
import { MessageBody } from "./MessageBody";
import { ExpandableRegion } from "./Motion";
import s from "./InlineMessage.module.css";

const displayAddressName = (raw: string): { name: string; email: string } | null => {
  const parsed = parseSender(raw);
  if (!parsed.email) return null;
  const email = parsed.email;
  const localPart = email.includes("@") ? parsed.localPart || email.split("@")[0] : "";
  return {
    name: parsed.name || localPart || email,
    email,
  };
};

const displayAddressList = (
  addresses: readonly string[] | undefined,
): { name: string; email: string }[] =>
  (addresses ?? []).map(displayAddressName).filter((addr) => addr !== null);

const AddressList = ({
  label,
  recipients,
}: {
  label: string;
  recipients: { name: string; email: string }[];
}) => {
  if (!recipients.length) return null;

  return (
    <span className={s.addressLine}>
      <span className={s.toLabel}>{label}</span>
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
    </span>
  );
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
  const sender = displayAddressName(m.author) ?? { name: name || "(unknown)", email: "" };
  const recipients = displayAddressList(m.recipients);
  const ccRecipients = displayAddressList(m.ccList);
  const bccRecipients = displayAddressList(m.bccList);
  const color = avatarColor(name);
  const [preview, setPreview] = useState<string | null>(null);
  const isDraft = m.origin === "draft";

  useEffect(() => {
    if (isOpen || preview !== null) return;

    let cancelled = false;
    void (async () => {
      try {
        // Verify the id before fetching: stale cached ids can belong to a
        // different message entirely (healing re-runs this with the live id).
        const liveId = await resolveLiveMessageId(m);
        if (cancelled) return;
        if (liveId === null) {
          setPreview("");
          return;
        }
        if (liveId !== m.id) {
          useMailStore.getState().healStaleMessage(m.id, liveId);
          return;
        }
        const part = await messenger.messages.getFull(liveId);
        if (!cancelled) setPreview(extractPreviewText(part));
      } catch {
        if (!cancelled) setPreview("");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, m, preview]);

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
              <span className={s.openHeaderAddresses}>
                {isDraft && <span className={s.draftBadge}>Draft</span>}
                <span className={s.senderOpen} title={sender.email}>
                  {sender.name}
                </span>
                <AddressList label="to" recipients={recipients} />
                <AddressList label="cc" recipients={ccRecipients} />
                <AddressList label="bcc" recipients={bccRecipients} />
              </span>
            ) : (
              <span className={clsx(s.sender, !m.read && s.senderUnread)}>
                {isDraft ? `Draft · ${name} → ` : m.origin === "sent" ? `${name} → ` : name}
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

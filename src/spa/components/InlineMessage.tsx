import { clsx } from "clsx";
import { useEffect, useId, useState } from "react";
import { liveTbId } from "../../shared/liveMessage";
import { parseSender } from "../../shared/senders";
import type { RawMessage } from "../../shared/types";
import { avatarColor, senderInitial, senderName } from "../lib/avatar";
import { formatDate, formatFullDate } from "../lib/dateBucket";
import { extractPreviewText } from "../lib/srcdoc";
import { MessageAttachments } from "./MessageAttachments";
import { MessageBody } from "./MessageBody";
import { ExpandableRegion } from "./Motion";
import { ContactPhoto } from "./ContactPhoto";
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

export const displayAddressList = (
  addresses: readonly string[] | undefined,
): { name: string; email: string }[] =>
  (addresses ?? []).map(displayAddressName).filter((addr) => addr !== null);

export const AddressList = ({
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
  placeholder,
}: {
  message: RawMessage;
  /** Body to show while the real one loads (see MessageBody). */
  placeholder?: { text: string; html?: string };
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
  const id = useId();
  const senderId = `${id}-sender`;
  const bodyId = `${id}-body`;
  // The message's toggle is its sender, open or closed, so it stays the same
  // element (and keeps focus) as the message opens. A click on it reaches
  // the header's handler like any other click on the header.
  const senderLabel = isOpen
    ? sender.name
    : isDraft
      ? `Draft · ${name} → `
      : m.origin === "sent"
        ? `${name} → `
        : name;
  const senderClass = clsx(
    s.senderToggle,
    isOpen ? s.senderOpen : [s.sender, !m.read && s.senderUnread],
  );

  useEffect(() => {
    if (isOpen || preview !== null) return;

    let cancelled = false;
    void (async () => {
      try {
        // Verify the id before fetching: stale cached ids can belong to a
        // different message entirely.
        const liveId = await liveTbId(m);
        if (cancelled) return;
        if (liveId === null) {
          setPreview("");
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
    <article className={s.message} aria-labelledby={senderId}>
      <div
        className={clsx(s.header, !canToggle && s.headerLocked)}
        onClick={(e) => {
          e.stopPropagation();
          if (canToggle) onToggle();
        }}
      >
        <div className={s.avatar} style={{ backgroundColor: color }} aria-hidden="true">
          <ContactPhoto address={m.author}>{senderInitial(m.author)}</ContactPhoto>
        </div>
        <div className={s.meta}>
          <div className={s.metaLine}>
            <span className={isOpen ? s.openHeaderAddresses : s.senderWrap}>
              {isOpen && isDraft && <span className={s.draftBadge}>Draft</span>}
              {canToggle ? (
                <button
                  type="button"
                  id={senderId}
                  className={senderClass}
                  title={isOpen ? sender.email : undefined}
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? bodyId : undefined}
                >
                  {senderLabel}
                </button>
              ) : (
                <span id={senderId} className={senderClass} title={isOpen ? sender.email : undefined}>
                  {senderLabel}
                </span>
              )}
              {isOpen && <AddressList label="to" recipients={recipients} />}
              {isOpen && <AddressList label="cc" recipients={ccRecipients} />}
              {isOpen && <AddressList label="bcc" recipients={bccRecipients} />}
            </span>
            <span className={s.date} title={formatFullDate(m.date)}>{formatDate(m.date)}</span>
          </div>
          {!isOpen && (
            <div className={s.preview}>
              {preview ?? "Loading message preview..."}
            </div>
          )}
          <ExpandableRegion
            id={bodyId}
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
                placeholder={placeholder}
              />
            </div>
          </ExpandableRegion>
          {m.attachments && m.attachments.length > 0 && (
            <MessageAttachments
              attachments={m.attachments.map((a) => ({ message: m, attachment: a }))}
              compact
            />
          )}
        </div>
      </div>
    </article>
  );
};

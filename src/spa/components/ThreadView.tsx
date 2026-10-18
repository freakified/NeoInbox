import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import type { Thread } from "../../shared/types";
import { useMailStore, type PendingReply } from "../../store/mailStore";
import { formatSnoozeToastTime } from "../lib/snoozePresets";
import { useBulkActions } from "./BulkActionConfirm";
import { BundleMenu } from "./BundleMenu";
import { Icon } from "./Icon";
import { InlineMessage } from "./InlineMessage";
import { InlineReply, isEditableDraft } from "./InlineReply";
import { useComposeMode } from "../lib/composePrefs";
import { PendingMessage } from "./PendingMessage";
import { ReplyFooter } from "./ReplyFooter";
import { SnoozeMenu } from "./SnoozeMenu";
import s from "./ThreadView.module.css";

const MIDDLE_COLLAPSE_THREAD_THRESHOLD = 8;

export const ThreadView = ({
  thread: t,
}: {
  thread: Thread;
}) => {
  const { doneMessages, trashMessages } = useBulkActions();
  const pin = useMailStore((st) => st.pin);
  const snoozeThread = useMailStore((st) => st.snoozeThread);
  const unsnoozeThread = useMailStore((st) => st.unsnoozeThread);
  const notify = useMailStore((st) => st.notify);
  const hydrateThreadDetails = useMailStore((st) => st.hydrateThreadDetails);
  const allPendingReplies = useMailStore((st) => st.pendingReplies);
  const settlePendingReply = useMailStore((st) => st.settlePendingReply);
  const inboxMessageKeys = useMemo(
    () => t.messages.filter((m) => m.origin === "inbox").map((m) => m.key),
    [t],
  );
  const hasInboxMessages = inboxMessageKeys.length > 0;
  const snoozedMessageKeys = useMemo(
    () => t.messages.filter((m) => m.snoozed).map((m) => m.key),
    [t],
  );

  const latestInbox = useMemo(() => {
    const inbox = t.messages.filter((m) => m.origin === "inbox");
    return inbox[inbox.length - 1] ?? t.messages[t.messages.length - 1];
  }, [t]);
  const replyTarget = [...t.messages].reverse().find((m) => m.origin === "inbox");
  const latestDraft = [...t.messages].reverse().find((m) => m.origin === "draft");
  // Inline replies can answer your own sent mail too (it goes to its recipients).
  const inlineReplyTarget =
    replyTarget ?? [...t.messages].reverse().find((m) => m.origin !== "draft");
  const composeMode = useComposeMode();
  const inlineCompose = composeMode !== "thunderbird" && !!inlineReplyTarget;
  // With inline compose the latest draft sits at the bottom as an editable
  // card (see InlineReply) instead of in the message list.
  const messages = useMemo(
    () =>
      inlineCompose && isEditableDraft(latestDraft)
        ? t.messages.filter((m) => m !== latestDraft)
        : t.messages,
    [t, inlineCompose, latestDraft],
  );
  const latestMessage = messages[messages.length - 1];

  // A reply being sent shows here until its Sent copy threads in: the first
  // sent message the thread didn't have when the reply went out.
  const { pendingReplies, arrived } = useMemo(() => {
    const pendingReplies: PendingReply[] = [];
    const arrived: { reply: PendingReply; messageKey: string }[] = [];
    for (const r of allPendingReplies) {
      if (r.threadId !== t.id) continue;
      const known = new Set(r.knownKeys);
      const landed = t.messages.find((m) => m.origin === "sent" && !known.has(m.key));
      if (landed) arrived.push({ reply: r, messageKey: landed.key });
      else pendingReplies.push(r);
    }
    return { pendingReplies, arrived };
  }, [allPendingReplies, t]);
  // The Sent copy shows the reply's text until its own body loads, so the
  // handoff doesn't flash "Loading…".
  const handoffs = useRef(new Map<string, PendingReply>());
  for (const { reply, messageKey } of arrived) handoffs.current.set(messageKey, reply);
  useEffect(() => {
    for (const { reply } of arrived) settlePendingReply(reply.requestId);
  }, [arrived, settlePendingReply]);
  // A pending reply is the newest message, so the one before it folds up as
  // it would once the reply lands.
  const latestOpen = pendingReplies.length === 0;

  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());
  const [showMiddle, setShowMiddle] = useState(false);
  const [translationRequests, setTranslationRequests] = useState<Record<string, number>>({});
  const [translatedSubject, setTranslatedSubject] = useState("");

  useEffect(() => {
    setTranslatedSubject("");
  }, [t.id]);

  // Sent and draft rows arrive with headers only; opening the conversation is
  // what pays for their details, so nothing downloads a year of Sent behind
  // your back. Threading already works without them — this sharpens it.
  const threadMessageKeys = useMemo(() => t.messages.map((m) => m.key), [t]);
  useEffect(() => {
    hydrateThreadDetails(threadMessageKeys);
  }, [hydrateThreadDetails, threadMessageKeys]);

  if (!latestInbox || !latestMessage) return null;

  const toggleMsg = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onTogglePin = () => {
    const next = !t.pinned;
    for (const m of t.messages) pin(m.key, next);
  };
  const onDone = () => doneMessages(inboxMessageKeys);
  const onSnooze = (wakeAt: number) => {
    snoozeThread(inboxMessageKeys, wakeAt);
    notify(`Snoozed until ${formatSnoozeToastTime(wakeAt)}`);
  };
  const onUnsnooze = () => {
    unsnoozeThread(snoozedMessageKeys);
    notify("Moved back to inbox");
  };
  const onTrash = () => trashMessages(t.messages.map((m) => m.key));
  const translateLatest = () => {
    setTranslationRequests((prev) => ({
      ...prev,
      [latestMessage.key]: (prev[latestMessage.key] ?? 0) + 1,
    }));
  };
  const shouldCollapseMiddleMessages = messages.length > MIDDLE_COLLAPSE_THREAD_THRESHOLD;

  return (
    <div>
      <div className={s.header}>
        <h2 className={s.title}>{translatedSubject || t.subject || "(no subject)"}</h2>
        <div className={s.headerActions}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            title={t.pinned ? "Unpin" : "Pin"}
            className={s.iconBtn}
          >
            <Icon
              name="push_pin"
              className={clsx(s.iconBtnIcon, t.pinned && s.iconBtnIconActive)}
            />
          </button>
          {hasInboxMessages && <SnoozeMenu onChoose={onSnooze} />}
          {snoozedMessageKeys.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUnsnooze();
              }}
              title="Unsnooze"
              className={s.iconBtn}
            >
              <Icon name="alarm_off" className={s.iconBtnIcon} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTrash();
            }}
            title="Move thread to trash"
            className={s.iconBtn}
          >
            <Icon name="delete" className={s.iconBtnIcon} />
          </button>
          {hasInboxMessages && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDone();
              }}
              title="Archive thread"
              className={s.iconBtn}
            >
              <Icon name="check" className={s.iconBtnIcon} />
            </button>
          )}
          <BundleMenu thread={t} onTranslateToEnglish={translateLatest} />
        </div>
      </div>


      <div className={s.messages}>
        {!shouldCollapseMiddleMessages ? (
          messages.map((m) => (
            <InlineMessage
              key={m.key}
              message={m}
              isOpen={(m.key === latestMessage.key && latestOpen) || openKeys.has(m.key)}
              canToggle={m.key !== latestMessage.key || !latestOpen}
              placeholder={handoffs.current.get(m.key)}
              onToggle={() => toggleMsg(m.key)}
              translationRequest={translationRequests[m.key] ?? 0}
              onTranslatedSubject={m.key === latestMessage.key ? setTranslatedSubject : undefined}
            />
          ))
        ) : (
          <>
            <InlineMessage
              key={messages[0]!.key}
              message={messages[0]!}
              isOpen={openKeys.has(messages[0]!.key)}
              onToggle={() => toggleMsg(messages[0]!.key)}
              translationRequest={translationRequests[messages[0]!.key] ?? 0}
              onTranslatedSubject={
                messages[0]!.key === latestMessage.key ? setTranslatedSubject : undefined
              }
            />
            {showMiddle ? (
              messages.slice(1, -1).map((m) => (
                <InlineMessage
                  key={m.key}
                  message={m}
                  isOpen={openKeys.has(m.key)}
                  onToggle={() => toggleMsg(m.key)}
                  translationRequest={translationRequests[m.key] ?? 0}
                  onTranslatedSubject={m.key === latestMessage.key ? setTranslatedSubject : undefined}
                />
              ))
            ) : (
              <button
                className={s.middleCollapsed}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMiddle(true);
                }}
                title={`Show ${messages.length - 2} hidden replies`}
              >
                <span className={s.middleRail} aria-hidden="true" />
                <span className={s.middleCount}>{messages.length - 2}</span>
                <span className={s.middleRail} aria-hidden="true" />
              </button>
            )}
            <InlineMessage
              key={latestMessage.key}
              message={latestMessage}
              isOpen={latestOpen || openKeys.has(latestMessage.key)}
              canToggle={!latestOpen}
              onToggle={() => toggleMsg(latestMessage.key)}
              placeholder={handoffs.current.get(latestMessage.key)}
              translationRequest={translationRequests[latestMessage.key] ?? 0}
              onTranslatedSubject={setTranslatedSubject}
            />
          </>
        )}
        {pendingReplies.map((r) => (
          <PendingMessage key={r.requestId} reply={r} />
        ))}
      </div>

      {inlineCompose && inlineReplyTarget ? (
        <InlineReply
          thread={t}
          replyTarget={inlineReplyTarget}
          draft={latestDraft}
          mode={composeMode}
        />
      ) : (
        <ReplyFooter replyTarget={replyTarget} draft={latestDraft} />
      )}
    </div>
  );
};

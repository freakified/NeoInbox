import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { isSameThread } from "../../shared/threading";
import type { Thread } from "../../shared/types";
import { useMailStore, type PendingReply } from "../../store/mailStore";
import { formatSnoozeToastTime } from "../lib/snoozePresets";
import { useThreadActions } from "../lib/useThreadActions";
import { BundleMenu } from "./BundleMenu";
import { Icon } from "./Icon";
import { InlineMessage } from "./InlineMessage";
import { InlineReply, isEditableDraft } from "./InlineReply";
import { PendingMessage } from "./PendingMessage";
import { ReplyFooter } from "./ReplyFooter";
import { SnoozeMenu } from "./SnoozeMenu";
import s from "./ThreadView.module.css";

const MIDDLE_COLLAPSE_THREAD_THRESHOLD = 8;

export const ThreadView = ({
  thread: t,
  rowKey,
  onCollapse,
  headingLevel = 3,
}: {
  thread: Thread;
  /** The row this conversation is open in (see toggleFocus). */
  rowKey: string;
  onCollapse: () => void;
  headingLevel?: number;
}) => {
  const actions = useThreadActions(t);
  const hydrateThreadDetails = useMailStore((st) => st.hydrateThreadDetails);
  const markThreadRead = useMailStore((st) => st.markThreadRead);
  const allPendingReplies = useMailStore((st) => st.pendingReplies);
  const settlePendingReply = useMailStore((st) => st.settlePendingReply);
  const latestInbox = useMemo(() => {
    const inbox = t.messages.filter((m) => m.origin === "inbox");
    return inbox[inbox.length - 1] ?? t.messages[t.messages.length - 1];
  }, [t]);
  const replyTarget = [...t.messages].reverse().find((m) => m.origin === "inbox");
  const latestDraft = [...t.messages].reverse().find((m) => m.origin === "draft");
  // Inline replies can answer your own sent mail too (it goes to its recipients).
  const inlineReplyTarget =
    replyTarget ?? [...t.messages].reverse().find((m) => m.origin !== "draft");
  const inlineCompose = !!inlineReplyTarget;
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
      if (!isSameThread(t, { id: r.threadId, keys: r.knownKeys })) continue;
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
  // Opening a conversation reads it, including mail that arrives while it
  // stays open. Keyed on the key list, not the thread: a failed mark-read
  // reverts the row, and re-firing on that would retry it forever.
  const threadKeyList = threadMessageKeys.join("\n");
  useEffect(() => {
    markThreadRead(threadKeyList.split("\n"));
  }, [markThreadRead, threadKeyList]);

  if (!latestInbox || !latestMessage) return null;

  const toggleMsg = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
        <div role="heading" aria-level={headingLevel} className={s.title}>
          {/* The open row's toggle: what its row was before it opened. */}
          <button
            type="button"
            className={s.titleBtn}
            data-row-header=""
            data-row-toggle={rowKey}
            aria-expanded={true}
            onClick={(e) => {
              e.stopPropagation();
              onCollapse();
            }}
          >
            {translatedSubject || t.subject || "(no subject)"}
          </button>
        </div>
        <div className={s.headerActions}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              actions.togglePin();
            }}
            title={t.pinned ? "Unpin" : "Pin"}
            className={s.iconBtn}
          >
            <Icon
              name="push_pin"
              className={clsx(s.iconBtnIcon, t.pinned && s.iconBtnIconActive)}
            />
          </button>
          {actions.isSnoozed ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                actions.unsnooze();
              }}
              title="Unsnooze"
              className={s.iconBtn}
            >
              <Icon
                name="schedule"
                className={clsx(s.iconBtnIcon, s.iconBtnIconSnoozed)}
                style={{ fontVariationSettings: "'FILL' 0" }}
              />
            </button>
          ) : (
            actions.hasInboxMessages && <SnoozeMenu onChoose={actions.snooze} />
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              actions.trash();
            }}
            title="Move thread to trash"
            className={s.iconBtn}
          >
            <Icon name="delete" className={s.iconBtnIcon} />
          </button>
          {actions.hasInboxMessages && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                actions.done();
              }}
              title="Archive thread"
              className={s.iconBtn}
            >
              <Icon name="check" className={s.iconBtnIcon} />
            </button>
          )}
          {actions.isDone && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                actions.moveToInbox();
              }}
              title="Move to inbox"
              className={s.iconBtn}
            >
              <Icon name="check" className={clsx(s.iconBtnIcon, s.iconBtnIconDone)} />
            </button>
          )}
          <BundleMenu
            thread={t}
            onTranslate={translateLatest}
            onReportSpam={actions.canReportSpam ? actions.reportSpam : undefined}
          />
        </div>
      </div>
      {actions.isSnoozed && actions.snoozeWakeAt !== undefined && (
        <div className={s.snoozedBanner}>
          Snoozed until {formatSnoozeToastTime(actions.snoozeWakeAt)}
        </div>
      )}

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
                aria-label={`Show ${messages.length - 2} hidden replies`}
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
        />
      ) : (
        <ReplyFooter replyTarget={replyTarget} draft={latestDraft} />
      )}
    </div>
  );
};

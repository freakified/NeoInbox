import { useEffect, useMemo, useState } from "react";
import type { Thread } from "../../shared/types";
import { useMailStore } from "../../store/mailStore";
import { formatSnoozeToastTime } from "../lib/snoozePresets";
import { useBulkActions } from "./BulkActionConfirm";
import { BundleMenu } from "./BundleMenu";
import { Icon } from "./Icon";
import { InlineMessage } from "./InlineMessage";
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
  const snoozeThread = useMailStore((st) => st.snoozeThread);
  const notify = useMailStore((st) => st.notify);
  const inboxMessageIds = useMemo(
    () => t.messages.filter((m) => m.origin === "inbox").map((m) => m.id),
    [t],
  );
  const hasInboxMessages = inboxMessageIds.length > 0;

  const latestInbox = useMemo(() => {
    const inbox = t.messages.filter((m) => m.origin === "inbox");
    return inbox[inbox.length - 1] ?? t.messages[t.messages.length - 1];
  }, [t]);
  const latestMessage = t.messages[t.messages.length - 1];
  const replyTarget = [...t.messages].reverse().find((m) => m.origin === "inbox");
  const latestDraft = [...t.messages].reverse().find((m) => m.origin === "draft");

  const [openIds, setOpenIds] = useState<Set<number>>(() => new Set());
  const [showMiddle, setShowMiddle] = useState(false);
  const [translationRequests, setTranslationRequests] = useState<Record<number, number>>({});
  const [translatedSubject, setTranslatedSubject] = useState("");

  useEffect(() => {
    setTranslatedSubject("");
  }, [t.id]);

  if (!latestInbox || !latestMessage) return null;

  const toggleMsg = (id: number) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onDone = () => doneMessages(inboxMessageIds);
  const onSnooze = (wakeAt: number) => {
    snoozeThread(inboxMessageIds, wakeAt);
    notify(`Snoozed until ${formatSnoozeToastTime(wakeAt)}`);
  };
  const onTrash = () => trashMessages(t.messages.map((m) => m.id));
  const translateLatest = () => {
    setTranslationRequests((prev) => ({
      ...prev,
      [latestMessage.id]: (prev[latestMessage.id] ?? 0) + 1,
    }));
  };
  const shouldCollapseMiddleMessages = t.messages.length > MIDDLE_COLLAPSE_THREAD_THRESHOLD;

  return (
    <div>
      <div className={s.header}>
        <h2 className={s.title}>{translatedSubject || t.subject || "(no subject)"}</h2>
        <div className={s.headerActions}>
          <BundleMenu thread={t} onTranslateToEnglish={translateLatest} />
          {hasInboxMessages && <SnoozeMenu onChoose={onSnooze} />}
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
        </div>
      </div>

      <div className={s.messages}>
        {!shouldCollapseMiddleMessages ? (
          t.messages.map((m) => (
            <InlineMessage
              key={m.id}
              message={m}
              isOpen={m.id === latestMessage.id || openIds.has(m.id)}
              canToggle={m.id !== latestMessage.id}
              onToggle={() => toggleMsg(m.id)}
              translationRequest={translationRequests[m.id] ?? 0}
              onTranslatedSubject={m.id === latestMessage.id ? setTranslatedSubject : undefined}
            />
          ))
        ) : (
          <>
            <InlineMessage
              key={t.messages[0]!.id}
              message={t.messages[0]!}
              isOpen={openIds.has(t.messages[0]!.id)}
              onToggle={() => toggleMsg(t.messages[0]!.id)}
              translationRequest={translationRequests[t.messages[0]!.id] ?? 0}
              onTranslatedSubject={
                t.messages[0]!.id === latestMessage.id ? setTranslatedSubject : undefined
              }
            />
            {showMiddle ? (
              t.messages.slice(1, -1).map((m) => (
                <InlineMessage
                  key={m.id}
                  message={m}
                  isOpen={openIds.has(m.id)}
                  onToggle={() => toggleMsg(m.id)}
                  translationRequest={translationRequests[m.id] ?? 0}
                  onTranslatedSubject={m.id === latestMessage.id ? setTranslatedSubject : undefined}
                />
              ))
            ) : (
              <button
                className={s.middleCollapsed}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMiddle(true);
                }}
                title={`Show ${t.messages.length - 2} hidden replies`}
              >
                <span className={s.middleRail} aria-hidden="true" />
                <span className={s.middleCount}>{t.messages.length - 2}</span>
                <span className={s.middleRail} aria-hidden="true" />
              </button>
            )}
            <InlineMessage
              key={latestMessage.id}
              message={latestMessage}
              isOpen
              canToggle={false}
              onToggle={() => undefined}
              translationRequest={translationRequests[latestMessage.id] ?? 0}
              onTranslatedSubject={setTranslatedSubject}
            />
          </>
        )}
      </div>

      <ReplyFooter replyTarget={replyTarget} draft={latestDraft} />
    </div>
  );
};

import { useMemo, useState } from "react";
import type { Thread } from "../../shared/types";
import { useMailStore } from "../../store/mailStore";
import { Icon } from "./Icon";
import { InlineMessage } from "./InlineMessage";
import { ReplyFooter } from "./ReplyFooter";
import s from "./ThreadView.module.css";

export const ThreadView = ({
  thread: t,
}: {
  thread: Thread;
}) => {
  const doneThread = useMailStore((st) => st.doneThread);
  const trashThread = useMailStore((st) => st.trashThread);

  const latestInbox = useMemo(() => {
    const inbox = t.messages.filter((m) => m.origin === "inbox");
    return inbox[inbox.length - 1] ?? t.messages[t.messages.length - 1];
  }, [t]);
  const latestMessage = t.messages[t.messages.length - 1];

  const [openIds, setOpenIds] = useState<Set<number>>(() => new Set());
  const [showMiddle, setShowMiddle] = useState(false);

  if (!latestInbox || !latestMessage) return null;

  const toggleMsg = (id: number) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onDone = () =>
    doneThread(
      t.messages.filter((m) => m.origin === "inbox").map((m) => m.id),
    );
  const onTrash = () => trashThread(t.messages.map((m) => m.id));

  return (
    <div>
      <div className={s.header}>
        <h2 className={s.title}>{t.subject || "(no subject)"}</h2>
        <div className={s.headerActions}>
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
        </div>
      </div>

      <div className={s.messages}>
        {t.messages.length <= 2 ? (
          t.messages.map((m) => (
            <InlineMessage
              key={m.id}
              message={m}
              isOpen={m.id === latestMessage.id || openIds.has(m.id)}
              canToggle={m.id !== latestMessage.id}
              onToggle={() => toggleMsg(m.id)}
            />
          ))
        ) : (
          <>
            <InlineMessage
              key={t.messages[0]!.id}
              message={t.messages[0]!}
              isOpen={openIds.has(t.messages[0]!.id)}
              onToggle={() => toggleMsg(t.messages[0]!.id)}
            />
            {showMiddle ? (
              t.messages.slice(1, -1).map((m) => (
                <InlineMessage
                  key={m.id}
                  message={m}
                  isOpen={openIds.has(m.id)}
                  onToggle={() => toggleMsg(m.id)}
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
            />
          </>
        )}
      </div>

      <ReplyFooter latest={latestInbox} />
    </div>
  );
};

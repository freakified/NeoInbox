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

  const [openIds, setOpenIds] = useState<Set<number>>(
    () => new Set(latestInbox ? [latestInbox.id] : []),
  );

  if (!latestInbox) return null;

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
              onDone();
            }}
            title="Archive thread"
            className={s.iconBtn}
          >
            <Icon name="archive" className={s.iconBtnIcon} />
          </button>
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
        </div>
      </div>

      <div className={s.messages}>
        {t.messages.map((m) => (
          <InlineMessage
            key={m.id}
            message={m}
            isOpen={openIds.has(m.id)}
            onToggle={() => toggleMsg(m.id)}
          />
        ))}
      </div>

      <ReplyFooter latest={latestInbox} />
    </div>
  );
};

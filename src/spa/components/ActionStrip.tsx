import { clsx } from "clsx";
import type { Thread } from "../../shared/types";
import { useMailStore } from "../../store/mailStore";
import { Icon } from "./Icon";
import { SnoozeMenu } from "./SnoozeMenu";
import s from "./ActionStrip.module.css";

export const ActionStrip = ({ thread }: { thread: Thread }) => {
  const pin = useMailStore((st) => st.pin);
  const doneThread = useMailStore((st) => st.doneThread);
  const snoozeThread = useMailStore((st) => st.snoozeThread);
  const trashThread = useMailStore((st) => st.trashThread);

  const togglePin = () => {
    const next = !thread.pinned;
    for (const m of thread.messages) pin(m.id, next);
  };
  const onDone = () =>
    doneThread(thread.messages.filter((m) => m.origin === "inbox").map((m) => m.id));
  const onSnooze = (wakeAt: number) =>
    snoozeThread(thread.messages.map((m) => m.id), wakeAt);
  const onTrash = () => trashThread(thread.messages.map((m) => m.id));

  return (
    <div className={s.strip} onClick={(e) => e.stopPropagation()}>
      <ActionBtn title={thread.pinned ? "Unpin" : "Pin"} onClick={togglePin}>
        <Icon
          name="push_pin"
          className={clsx(s.iconBase, thread.pinned ? s.iconPrimary : s.iconMuted)}
        />
      </ActionBtn>
      <SnoozeMenu onChoose={onSnooze} />
      <ActionBtn title="Trash" onClick={onTrash}>
        <Icon name="delete" className={clsx(s.iconBase, s.iconMuted)} />
      </ActionBtn>
      <ActionBtn title="Done" onClick={onDone}>
        <Icon name="check" className={clsx(s.iconBase, s.iconMuted)} />
      </ActionBtn>
    </div>
  );
};

const ActionBtn = ({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    title={title}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    className={s.btn}
  >
    {children}
  </button>
);

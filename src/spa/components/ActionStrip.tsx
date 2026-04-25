import type { Thread } from "../../shared/types";
import { useMailStore } from "../../store/mailStore";
import { Icon } from "./Icon";
import { SnoozeMenu } from "./SnoozeMenu";

export const ActionStrip = ({ thread }: { thread: Thread }) => {
  const pin = useMailStore((s) => s.pin);
  const doneThread = useMailStore((s) => s.doneThread);
  const snoozeThread = useMailStore((s) => s.snoozeThread);
  const trashThread = useMailStore((s) => s.trashThread);

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
    <div
      className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center bg-white shadow-elevation-1 rounded"
      onClick={(e) => e.stopPropagation()}
    >
      <ActionBtn title={thread.pinned ? "Unpin" : "Pin"} onClick={togglePin}>
        <Icon
          name="push_pin"
          className={`text-lg ${thread.pinned ? "text-md-primary" : "text-neutral-400"}`}
        />
      </ActionBtn>
      <SnoozeMenu onChoose={onSnooze} />
      <ActionBtn title="Trash" onClick={onTrash}>
        <Icon name="delete" className="text-lg text-neutral-400" />
      </ActionBtn>
      <ActionBtn title="Done" onClick={onDone}>
        <Icon name="check" className="text-lg text-neutral-400" />
      </ActionBtn>
    </div>
  );
}

const ActionBtn = ({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) => {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="p-1.5 rounded-full hover:bg-neutral-100 leading-none"
    >
      {children}
    </button>
  );
}

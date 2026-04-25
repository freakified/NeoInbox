import type { Thread } from "../../shared/types";
import { useMailStore } from "../../store/mailStore";
import { SnoozeMenu } from "./SnoozeMenu";

export function ActionStrip({ thread }: { thread: Thread }) {
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
      className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 bg-white shadow rounded px-1 py-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      <ActionBtn title={thread.pinned ? "Unpin" : "Pin"} onClick={togglePin}>
        {thread.pinned ? "📌" : "📍"}
      </ActionBtn>
      <SnoozeMenu onChoose={onSnooze} />
      <ActionBtn title="Done (archive)" onClick={onDone}>
        ✓
      </ActionBtn>
      <ActionBtn title="Trash" onClick={onTrash}>
        🗑
      </ActionBtn>
    </div>
  );
}

function ActionBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="p-1 rounded hover:bg-neutral-100 text-sm leading-none"
    >
      {children}
    </button>
  );
}

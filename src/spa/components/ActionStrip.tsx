import { clsx } from "clsx";
import { SNOOZED_KEY } from "../../shared/categories";
import type { Thread } from "../../shared/types";
import { useMailStore } from "../../store/mailStore";
import { useShowDeleteActions } from "../lib/deleteActionPrefs";
import { formatSnoozeToastTime } from "../lib/snoozePresets";
import { useBulkActions } from "./BulkActionConfirm";
import { Icon } from "./Icon";
import { SnoozeMenu } from "./SnoozeMenu";
import s from "./ActionStrip.module.css";

export const ActionStrip = ({ thread }: { thread: Thread }) => {
  const pin = useMailStore((st) => st.pin);
  const snoozeThread = useMailStore((st) => st.snoozeThread);
  const unsnoozeThread = useMailStore((st) => st.unsnoozeThread);
  const notify = useMailStore((st) => st.notify);
  const showDeleteActions = useShowDeleteActions();
  const { doneMessages, trashMessages } = useBulkActions();
  const inboxMessageIds = thread.messages.filter((m) => m.origin === "inbox").map((m) => m.id);
  const hasInboxMessages = inboxMessageIds.length > 0;
  const snoozedMessageIds = thread.messages
    .filter((m) => m.tags.includes(SNOOZED_KEY))
    .map((m) => m.id);

  const togglePin = () => {
    const next = !thread.pinned;
    for (const m of thread.messages) pin(m.id, next);
  };
  const onDone = () => doneMessages(inboxMessageIds);
  const onSnooze = (wakeAt: number) => {
    snoozeThread(inboxMessageIds, wakeAt);
    notify(`Snoozed until ${formatSnoozeToastTime(wakeAt)}`);
  };
  const onUnsnooze = () => {
    unsnoozeThread(snoozedMessageIds);
    notify("Moved back to inbox");
  };
  const onTrash = () => trashMessages(thread.messages.map((m) => m.id));

  return (
    <div className={s.strip} onClick={(e) => e.stopPropagation()}>
      <ActionBtn title={thread.pinned ? "Unpin" : "Pin"} onClick={togglePin}>
        <Icon
          name="push_pin"
          className={clsx(s.iconBase, thread.pinned ? s.iconPrimary : s.iconMuted)}
        />
      </ActionBtn>
      {hasInboxMessages && <SnoozeMenu onChoose={onSnooze} />}
      {snoozedMessageIds.length > 0 && (
        <ActionBtn title="Unsnooze" onClick={onUnsnooze}>
          <Icon name="alarm_off" className={clsx(s.iconBase, s.iconMuted)} />
        </ActionBtn>
      )}
      {showDeleteActions && (
        <ActionBtn title="Trash" onClick={onTrash}>
          <Icon name="delete" className={clsx(s.iconBase, s.iconMuted)} />
        </ActionBtn>
      )}
      {hasInboxMessages && (
        <ActionBtn title="Done" onClick={onDone}>
          <Icon name="check" className={clsx(s.iconBase, s.iconMuted)} />
        </ActionBtn>
      )}
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

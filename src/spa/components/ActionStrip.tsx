import { clsx } from "clsx";
import type { Thread } from "../../shared/types";
import { useThreadActions } from "../lib/useThreadActions";
import { BundleMenu } from "./BundleMenu";
import { Icon } from "./Icon";
import { SnoozeMenu } from "./SnoozeMenu";
import s from "./ActionStrip.module.css";

export const ActionStrip = ({ thread }: { thread: Thread }) => {
  const actions = useThreadActions(thread);

  return (
    <div className={s.strip} onClick={(e) => e.stopPropagation()}>
      <ActionBtn title={thread.pinned ? "Unpin (p)" : "Pin (p)"} onClick={actions.togglePin}>
        <Icon
          name="push_pin"
          className={clsx(s.iconBase, thread.pinned ? s.iconPrimary : s.iconMuted)}
        />
      </ActionBtn>
      {actions.hasInboxMessages && <SnoozeMenu onChoose={actions.snooze} />}
      {actions.hasSnoozedMessages && (
        <ActionBtn title="Unsnooze" onClick={actions.unsnooze}>
          <Icon name="alarm_off" className={clsx(s.iconBase, s.iconMuted)} />
        </ActionBtn>
      )}
      <ActionBtn title="Trash (#)" onClick={actions.trash}>
        <Icon name="delete" className={clsx(s.iconBase, s.iconMuted)} />
      </ActionBtn>
      {actions.hasInboxMessages && (
        <ActionBtn title="Done (e)" onClick={actions.done}>
          <Icon name="check" className={clsx(s.iconBase, s.iconMuted)} />
        </ActionBtn>
      )}
      {!actions.hasInboxMessages && actions.hasDoneMessages && (
        <ActionBtn title="Move to inbox" onClick={actions.moveToInbox}>
          <Icon name="move_to_inbox" className={clsx(s.iconBase, s.iconMuted)} />
        </ActionBtn>
      )}
      <BundleMenu thread={thread} />
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

import { useState } from "react";
import { clsx } from "clsx";
import type { Thread } from "../../shared/types";
import { tripIdOfThread } from "../../shared/trips";
import { useMailStore, useTripMemberships } from "../../store/mailStore";
import { useShowDeleteActions } from "../lib/deleteActionPrefs";
import { formatSnoozeToastTime } from "../lib/snoozePresets";
import { useBulkActions } from "./BulkActionConfirm";
import { Icon } from "./Icon";
import { SnoozeMenu } from "./SnoozeMenu";
import { TripPickerDialog } from "./TripPickerDialog";
import s from "./ActionStrip.module.css";

export const ActionStrip = ({ thread }: { thread: Thread }) => {
  const pin = useMailStore((st) => st.pin);
  const snoozeThread = useMailStore((st) => st.snoozeThread);
  const unsnoozeThread = useMailStore((st) => st.unsnoozeThread);
  const notify = useMailStore((st) => st.notify);
  const showDeleteActions = useShowDeleteActions();
  const { doneMessages, trashMessages } = useBulkActions();
  const moveToInboxThread = useMailStore((st) => st.moveToInboxThread);
  const tripMemberships = useTripMemberships();
  const [tripPickerOpen, setTripPickerOpen] = useState(false);
  const currentTripId = tripIdOfThread(thread, tripMemberships);
  // Travel mail can always be filed into a trip; other mail only shows the
  // action once it's in one (so it can be moved back out).
  const showTripAction = thread.category === "travel" || currentTripId !== null;
  const inboxMessageIds = thread.messages.filter((m) => m.origin === "inbox").map((m) => m.id);
  const hasInboxMessages = inboxMessageIds.length > 0;
  const doneMessageIds = thread.messages.filter((m) => m.origin === "done").map((m) => m.id);
  const snoozedMessageIds = thread.messages
    .filter((m) => m.snoozed)
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
  const onMoveToInbox = () => {
    moveToInboxThread(doneMessageIds);
    notify("Moved back to inbox");
  };

  return (
    <div className={s.strip} onClick={(e) => e.stopPropagation()}>
      <ActionBtn title={thread.pinned ? "Unpin" : "Pin"} onClick={togglePin}>
        <Icon
          name="push_pin"
          className={clsx(s.iconBase, thread.pinned ? s.iconPrimary : s.iconMuted)}
        />
      </ActionBtn>
      {showTripAction && (
        <ActionBtn
          title={currentTripId ? "Change trip" : "Move to trip"}
          onClick={() => setTripPickerOpen(true)}
        >
          <Icon
            name="flight"
            className={clsx(s.iconBase, currentTripId ? s.iconPrimary : s.iconMuted)}
          />
        </ActionBtn>
      )}
      {tripPickerOpen && (
        <TripPickerDialog
          thread={thread}
          currentTripId={currentTripId}
          onClose={() => setTripPickerOpen(false)}
        />
      )}
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
      {!hasInboxMessages && doneMessageIds.length > 0 && (
        <ActionBtn title="Move to inbox" onClick={onMoveToInbox}>
          <Icon name="move_to_inbox" className={clsx(s.iconBase, s.iconMuted)} />
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

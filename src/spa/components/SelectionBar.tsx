import type { Thread } from "../../shared/types";
import { useMailStore } from "../../store/mailStore";
import { useShowDeleteActions } from "../lib/deleteActionPrefs";
import { formatSnoozeToastTime } from "../lib/snoozePresets";
import { useBulkActions } from "./BulkActionConfirm";
import { Icon } from "./Icon";
import { SelectionMoveMenu } from "./SelectionMoveMenu";
import { SnoozeMenu } from "./SnoozeMenu";
import s from "./SelectionBar.module.css";

const conversations = (n: number): string => `${n} conversation${n === 1 ? "" : "s"}`;

/**
 * What the app bar turns into while conversations are selected: a count, a
 * way out, and the row verbs applied to the whole selection. Each verb only
 * shows when at least one selected thread can take it, the same rule the
 * per-row action strip follows.
 */
export const SelectionBar = ({
  threads,
  onClear,
}: {
  threads: Thread[];
  onClear: () => void;
}) => {
  const pin = useMailStore((st) => st.pin);
  const snoozeThread = useMailStore((st) => st.snoozeThread);
  const unsnoozeThread = useMailStore((st) => st.unsnoozeThread);
  const moveToInboxThread = useMailStore((st) => st.moveToInboxThread);
  const notify = useMailStore((st) => st.notify);
  const { doneMessages, trashMessages } = useBulkActions();
  const showDeleteActions = useShowDeleteActions();

  const messages = threads.flatMap((t) => t.messages);
  const inboxIds = messages.filter((m) => m.origin === "inbox").map((m) => m.key);
  const doneIds = messages.filter((m) => m.origin === "done").map((m) => m.key);
  const snoozedIds = messages.filter((m) => m.snoozed).map((m) => m.key);
  // Pin acts like the row toggle across the lot: unpin only when every
  // selected thread is already pinned, otherwise pin them all.
  const allPinned = threads.length > 0 && threads.every((t) => t.pinned);

  const act = (run: () => void) => () => {
    run();
    onClear();
  };

  return (
    <>
      <div className={s.left}>
        <button
          type="button"
          className={s.btn}
          title="Clear selection (Esc)"
          aria-label="Clear selection"
          onClick={onClear}
        >
          <Icon name="close" className={s.icon} />
        </button>
        <h1 className={s.count} aria-live="polite">
          {threads.length} selected
        </h1>
      </div>
      <div className={s.right}>
        <button
          type="button"
          className={s.btn}
          title={allPinned ? "Unpin" : "Pin"}
          aria-label={allPinned ? "Unpin" : "Pin"}
          aria-pressed={allPinned}
          onClick={() => {
            for (const m of messages) pin(m.key, !allPinned);
          }}
        >
          <Icon name="push_pin" className={allPinned ? s.iconOn : s.icon} />
        </button>
        {inboxIds.length > 0 && (
          <SnoozeMenu
            triggerClassName={s.btn}
            iconClassName={s.icon}
            onChoose={(wakeAt) => {
              snoozeThread(inboxIds, wakeAt);
              notify(`Snoozed ${conversations(threads.length)} until ${formatSnoozeToastTime(wakeAt)}`);
              onClear();
            }}
          />
        )}
        <SelectionMoveMenu threads={threads} triggerClassName={s.btn} iconClassName={s.icon} onDone={onClear} />
        {snoozedIds.length > 0 && (
          <button
            type="button"
            className={s.btn}
            title="Unsnooze"
            aria-label="Unsnooze"
            onClick={act(() => {
              unsnoozeThread(snoozedIds);
              notify(`Moved ${conversations(threads.length)} back to inbox`);
            })}
          >
            <Icon name="alarm_off" className={s.icon} />
          </button>
        )}
        {inboxIds.length === 0 && doneIds.length > 0 && (
          <button
            type="button"
            className={s.btn}
            title="Move to inbox"
            aria-label="Move to inbox"
            onClick={act(() => {
              moveToInboxThread(doneIds);
              notify(`Moved ${conversations(threads.length)} back to inbox`);
            })}
          >
            <Icon name="move_to_inbox" className={s.icon} />
          </button>
        )}
        {showDeleteActions && (
          <button
            type="button"
            className={s.btn}
            title="Trash"
            aria-label="Trash"
            onClick={act(() => trashMessages(messages.map((m) => m.key)))}
          >
            <Icon name="delete" className={s.icon} />
          </button>
        )}
        {inboxIds.length > 0 && (
          <button
            type="button"
            className={s.btn}
            title="Done"
            aria-label="Done"
            onClick={act(() => doneMessages(inboxIds))}
          >
            <Icon name="check" className={s.icon} />
          </button>
        )}
      </div>
    </>
  );
};

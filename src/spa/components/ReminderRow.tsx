import { clsx } from "clsx";
import { useState } from "react";
import type { ReminderRecord } from "../../shared/types";
import { useMailStore } from "../../store/mailStore";
import { formatDate, formatTimeAgo } from "../lib/dateBucket";
import { formatSnoozeToastTime } from "../lib/snoozePresets";
import strip from "./ActionStrip.module.css";
import { Highlight } from "./Highlight";
import { Icon } from "./Icon";
import { MotionRow } from "./Motion";
import { ReminderComposer } from "./ReminderComposer";
import { RowHeader } from "./RowHeader";
import { SnoozeMenu } from "./SnoozeMenu";
import s from "./ReminderRow.module.css";

const ReminderActionStrip = ({ reminder }: { reminder: ReminderRecord }) => {
  const setReminderPinned = useMailStore((st) => st.setReminderPinned);
  const snoozeReminder = useMailStore((st) => st.snoozeReminder);
  const unsnoozeReminder = useMailStore((st) => st.unsnoozeReminder);
  const doneReminder = useMailStore((st) => st.doneReminder);
  const restoreReminder = useMailStore((st) => st.restoreReminder);
  const deleteReminder = useMailStore((st) => st.deleteReminder);
  const notify = useMailStore((st) => st.notify);
  const active = reminder.status === "active";
  const snoozed = reminder.snoozeWakeAt !== undefined;

  return (
    <div className={strip.strip} onClick={(e) => e.stopPropagation()}>
      <button
        title={reminder.pinned ? "Unpin" : "Pin"}
        onClick={(e) => {
          e.stopPropagation();
          setReminderPinned(reminder.id, !reminder.pinned);
        }}
        className={strip.btn}
      >
        <Icon
          name="push_pin"
          className={clsx(strip.iconBase, reminder.pinned ? strip.iconPrimary : strip.iconMuted)}
        />
      </button>
      {active && !snoozed && (
        <SnoozeMenu
          onChoose={(wakeAt) => {
            snoozeReminder(reminder.id, wakeAt);
            notify(`Snoozed until ${formatSnoozeToastTime(wakeAt)}`);
          }}
        />
      )}
      {active && snoozed && (
        <button
          title="Unsnooze"
          onClick={(e) => {
            e.stopPropagation();
            unsnoozeReminder(reminder.id);
            notify("Moved back to inbox");
          }}
          className={strip.btn}
        >
          <Icon name="alarm_off" className={clsx(strip.iconBase, strip.iconMuted)} />
        </button>
      )}
      <button
        title="Delete"
        onClick={(e) => {
          e.stopPropagation();
          deleteReminder(reminder.id);
        }}
        className={strip.btn}
      >
        <Icon name="delete" className={clsx(strip.iconBase, strip.iconMuted)} />
      </button>
      {active ? (
        <button
          title="Done"
          onClick={(e) => {
            e.stopPropagation();
            doneReminder(reminder.id);
          }}
          className={strip.btn}
        >
          <Icon name="check" className={clsx(strip.iconBase, strip.iconMuted)} />
        </button>
      ) : (
        <button
          title="Move to inbox"
          onClick={(e) => {
            e.stopPropagation();
            restoreReminder(reminder.id);
          }}
          className={strip.btn}
        >
          <Icon name="move_to_inbox" className={clsx(strip.iconBase, strip.iconMuted)} />
        </button>
      )}
    </div>
  );
};

export const ReminderRow = ({ reminder }: { reminder: ReminderRecord }) => {
  const [editing, setEditing] = useState(false);

  const baseDate = reminder.snoozeWakeAt !== undefined ? (
    <span className={s.snoozeDue}>
      <span>{formatDate(reminder.snoozeWakeAt)}</span>
      <Icon name="schedule" className={s.snoozeIcon} />
    </span>
  ) : null;
  const woke = reminder.snoozeWakeAt === undefined && reminder.resurfacedAt && reminder.snoozeExpired ? (
    <span title={`Snoozed until ${formatSnoozeToastTime(reminder.resurfacedAt)}`}>
      Snoozed {formatTimeAgo(reminder.resurfacedAt)}
    </span>
  ) : null;
  const date = reminder.pinned ? (
    <span className={s.pinnedDate}>
      {baseDate}
      <Icon name="push_pin" className={s.pinIndicator} />
    </span>
  ) : baseDate;

  return (
    <MotionRow data-row data-row-key={`reminder:${reminder.id}`} className={s.row}>
      <RowHeader
        leading={
          <div className={s.avatar}>
            <Icon name="pan_tool_alt" className={s.avatarIcon} />
          </div>
        }
        primary="Reminder"
        secondary={<Highlight text={reminder.text} />}
        subline={woke}
        date={date}
        onClick={() => setEditing(true)}
        actionStrip={<ReminderActionStrip reminder={reminder} />}
      />
      {editing && (
        <ReminderComposer reminder={reminder} onClose={() => setEditing(false)} />
      )}
    </MotionRow>
  );
};

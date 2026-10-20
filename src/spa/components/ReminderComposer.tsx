import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import type { ReminderRecord } from "../../shared/types";
import { useMailStore } from "../../store/mailStore";
import { suggestReminders } from "../lib/reminderSuggestions";
import { formatSnoozeToastTime } from "../lib/snoozePresets";
import { Icon } from "./Icon";
import { SnoozeMenu } from "./SnoozeMenu";
import s from "./ReminderComposer.module.css";

export const ReminderComposer = ({
  reminder,
  onClose,
}: {
  /** When set, edits this reminder instead of creating a new one. */
  reminder?: ReminderRecord;
  onClose: () => void;
}) => {
  const createReminder = useMailStore((st) => st.createReminder);
  const updateReminderText = useMailStore((st) => st.updateReminderText);
  const setReminderPinned = useMailStore((st) => st.setReminderPinned);
  const snoozeReminder = useMailStore((st) => st.snoozeReminder);
  const [text, setText] = useState(reminder?.text ?? "");
  const [pinned, setPinned] = useState(reminder?.pinned ?? false);
  const [snoozeWakeAt, setSnoozeWakeAt] = useState(reminder?.snoozeWakeAt);
  const remindersById = useMailStore((st) => st.remindersById);
  /** Highlighted suggestion (arrow keys), -1 for none. */
  const [active, setActive] = useState(-1);
  /** A suggestion was just taken; stay quiet until the next keystroke. */
  const [picked, setPicked] = useState(false);
  const listId = useId();
  const suggestions = useMemo(
    () =>
      picked
        ? []
        : suggestReminders(
            text,
            Object.values(remindersById).map((r) => r.text),
          ),
    [text, remindersById, picked],
  );
  const pick = (index: number) => {
    const parts = suggestions[index];
    if (!parts) return;
    setText(parts.map((p) => p.text).join(""));
    setPicked(true);
    setActive(-1);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const submit = () => {
    if (!text.trim()) return;
    if (reminder) {
      updateReminderText(reminder.id, text);
      if (pinned !== reminder.pinned) setReminderPinned(reminder.id, pinned);
      if (snoozeWakeAt && snoozeWakeAt !== reminder.snoozeWakeAt) {
        snoozeReminder(reminder.id, snoozeWakeAt);
      }
    } else {
      void createReminder(text, { pinned, snoozeWakeAt });
    }
    onClose();
  };

  return createPortal(
    <div className={s.overlay} onClick={onClose}>
      <div
        className={s.card}
        role="dialog"
        aria-modal="true"
        aria-label={reminder ? "Edit reminder" : "New reminder"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.bar}>
          <Icon name="pan_tool_alt" className={s.handIcon} />
          <input
            className={s.input}
            type="text"
            placeholder="Remind me to…"
            aria-label="Reminder"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            value={text}
            maxLength={500}
            onChange={(e) => {
              setText(e.currentTarget.value);
              setPicked(false);
              setActive(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                if (!suggestions.length) return;
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                // Wraps through "none" (-1), like a browser's autocomplete.
                const n = suggestions.length + 1;
                setActive((i) => ((i + 1 + step + n) % n) - 1);
              } else if (e.key === "Enter") {
                if (active >= 0) pick(active);
                else submit();
              }
            }}
            autoFocus
          />
          {snoozeWakeAt && (
            <span className={s.snoozeLabel}>{formatSnoozeToastTime(snoozeWakeAt)}</span>
          )}
          <SnoozeMenu
            onChoose={setSnoozeWakeAt}
            iconClassName={clsx(s.actionIcon, snoozeWakeAt && s.snoozeIconSet)}
          />
          <button
            type="button"
            className={s.iconBtn}
            aria-pressed={pinned}
            title={pinned ? "Unpin" : "Pin"}
            onClick={() => setPinned((p) => !p)}
          >
            <Icon name="push_pin" className={clsx(s.actionIcon, pinned && s.pinIconSet)} />
          </button>
          <button type="button" className={s.saveBtn} disabled={!text.trim()} onClick={submit}>
            Save
          </button>
        </div>
        {suggestions.length > 0 && (
          <ul id={listId} role="listbox" aria-label="Suggestions" className={s.suggestions}>
            {suggestions.map((parts, i) => (
              <li
                key={parts.map((p) => p.text).join("")}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={clsx(s.suggestion, i === active && s.suggestionActive)}
                // Keep focus in the field, so typing can carry on after a pick.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(i)}
              >
                {/* Inbox bolded what it added, not what was typed. */}
                {parts.map((p, j) =>
                  p.typed ? <span key={j}>{p.text}</span> : <b key={j}>{p.text}</b>,
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
};

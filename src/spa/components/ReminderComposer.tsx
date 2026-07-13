import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ReminderRecord } from "../../shared/types";
import { useMailStore } from "../../store/mailStore";
import { Icon } from "./Icon";
import s from "./ReminderComposer.module.css";

export const ReminderComposer = ({
  reminder,
  onClose,
}: {
  /** When set, edits this reminder's text instead of creating a new one. */
  reminder?: ReminderRecord;
  onClose: () => void;
}) => {
  const createReminder = useMailStore((st) => st.createReminder);
  const updateReminderText = useMailStore((st) => st.updateReminderText);
  const [text, setText] = useState(reminder?.text ?? "");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const submit = () => {
    if (!text.trim()) return;
    if (reminder) updateReminderText(reminder.id, text);
    else createReminder(text);
    onClose();
  };

  return createPortal(
    <div className={s.overlay} onClick={onClose}>
      <div
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={reminder ? "Edit reminder" : "New reminder"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.inputRow}>
          <span className={s.handBadge}>
            <Icon name="pan_tool_alt" className={s.handIcon} />
          </span>
          <input
            className={s.input}
            type="text"
            placeholder="Remind me to…"
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            autoFocus
          />
        </div>
        <div className={s.actions}>
          <button type="button" className={s.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={s.saveBtn}
            disabled={!text.trim()}
            onClick={submit}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

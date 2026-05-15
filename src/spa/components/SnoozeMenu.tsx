import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  defaultCustomSnooze,
  formatSnoozeOptionTime,
  snoozePresets,
} from "../lib/snoozePresets";
import { Icon } from "./Icon";
import s from "./SnoozeMenu.module.css";

const localDateValue = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const localTimeValue = (date: Date): string => {
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
};

const parseLocalDateTime = (dateValue: string, timeValue: string): number => {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  if (
    !year ||
    !month ||
    !day ||
    hour === undefined ||
    minute === undefined ||
    Number.isNaN(hour) ||
    Number.isNaN(minute)
  ) {
    return NaN;
  }
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
};

export const SnoozeMenu = ({
  onChoose,
}: {
  onChoose: (wakeAt: number) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const choose = (wakeAt: number) => {
    setOpen(false);
    setPickerOpen(false);
    onChoose(wakeAt);
  };

  return (
    <div ref={ref} className={s.wrapper}>
      <button
        type="button"
        title="Snooze"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={s.trigger}
      >
        <Icon name="snooze" className={s.triggerIcon} />
      </button>
      {open && (
        <div className={s.dropdown} role="menu" aria-label="Snooze until">
          <div className={s.title}>Snooze until...</div>
          {snoozePresets().map(({ label, icon, wakeAt }) => (
            <button
              key={label}
              className={s.option}
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                choose(wakeAt);
              }}
            >
              <Icon name={icon} className={s.optionIcon} />
              <span className={s.optionLabel}>{label}</span>
              <span className={s.optionTime}>{formatSnoozeOptionTime(wakeAt)}</span>
            </button>
          ))}
          <div className={s.divider} />
          <button
            className={s.option}
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              setPickerOpen(true);
            }}
          >
            <Icon name="event" className={s.optionIcon} />
            <span className={s.optionLabel}>Pick date &amp; time</span>
          </button>
        </div>
      )}
      {pickerOpen && (
        <SnoozePicker
          onCancel={() => setPickerOpen(false)}
          onChoose={choose}
        />
      )}
    </div>
  );
};

const SnoozePicker = ({
  onCancel,
  onChoose,
}: {
  onCancel: () => void;
  onChoose: (wakeAt: number) => void;
}) => {
  const initial = defaultCustomSnooze();
  const [dateValue, setDateValue] = useState(localDateValue(initial));
  const [timeValue, setTimeValue] = useState(localTimeValue(initial));
  const [error, setError] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  const submit = () => {
    const wakeAt = parseLocalDateTime(dateValue, timeValue);
    if (!Number.isFinite(wakeAt)) {
      setError("Choose a valid date and time.");
      return;
    }
    if (wakeAt <= Date.now()) {
      setError("Choose a time in the future.");
      return;
    }
    onChoose(wakeAt);
  };

  return createPortal(
    <div
      className={s.overlay}
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="snooze-picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="snooze-picker-title" className={s.dialogTitle}>
          Pick date &amp; time
        </h2>
        <div className={s.fields}>
          <label className={s.field}>
            <span className={s.fieldLabel}>Date</span>
            <input
              className={s.input}
              type="date"
              min={localDateValue(new Date())}
              value={dateValue}
              onChange={(e) => {
                setDateValue(e.currentTarget.value);
                setError("");
              }}
              autoFocus
            />
          </label>
          <label className={s.field}>
            <span className={s.fieldLabel}>Time</span>
            <input
              className={s.input}
              type="time"
              value={timeValue}
              onChange={(e) => {
                setTimeValue(e.currentTarget.value);
                setError("");
              }}
            />
          </label>
        </div>
        {error && <p className={s.error}>{error}</p>}
        <div className={s.actions}>
          <button type="button" className={s.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={s.okBtn} onClick={submit}>
            Snooze
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

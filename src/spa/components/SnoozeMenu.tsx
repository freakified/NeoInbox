import { clsx } from "clsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  defaultCustomSnooze,
  formatSnoozeOptionTime,
  setMinutes,
  snoozePresets,
} from "../lib/snoozePresets";
import { useMenuFocus } from "../lib/useMenuFocus";
import {
  setLastCustomSnooze,
  TIME_OF_DAY_LABELS,
  TIMES_OF_DAY,
  SNOOZE_PREFS,
  type TimeOfDay,
} from "../lib/snoozePrefs";
import { Icon } from "./Icon";
import s from "./SnoozeMenu.module.css";

const localTimeValue = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const parseTimeValue = (value: string): number => {
  const [hour, minute] = value.split(":").map(Number);
  if (hour === undefined || minute === undefined || Number.isNaN(hour) || Number.isNaN(minute)) {
    return NaN;
  }
  return hour * 60 + minute;
};

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const formatMinutes = (minutes: number): string =>
  new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    setMinutes(new Date(), minutes),
  );

export const SnoozeMenu = ({
  onChoose,
  triggerClassName,
  iconClassName,
}: {
  onChoose: (wakeAt: number) => void;
  /** Restyles the trigger for a different surface, such as the selection bar. */
  triggerClassName?: string;
  iconClassName?: string;
}) => {
  const [open, setOpen] = useState(false);
  // Like Inbox, "Pick date & time" turns the menu card itself into the form.
  const [picking, setPicking] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const close = () => {
    setOpen(false);
    setPicking(false);
  };

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 32);
      const left = Math.min(
        window.innerWidth - width - 16,
        Math.max(16, rect.right - width),
      );
      // The picker is taller than the menu; keep it on screen near the bottom.
      const height = dropdownRef.current?.offsetHeight ?? 0;
      const top = Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - height - 16));
      setDropdownStyle({ left, top, width });
    };

    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (dropdownRef.current) observer.observe(dropdownRef.current);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, picking]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        ref.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) return;
      close();
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const menuFocus = useMenuFocus({
    open,
    onClose: close,
    triggerRef,
    menuRef: dropdownRef,
    dialog: picking,
    layoutKey: picking,
  });

  const choose = (wakeAt: number) => {
    close();
    onChoose(wakeAt);
  };

  return (
    <div ref={ref} className={s.wrapper}>
      <button
        ref={triggerRef}
        type="button"
        title="Snooze"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (open) close();
          else setOpen(true);
        }}
        className={triggerClassName ?? s.trigger}
      >
        <Icon
          name="schedule"
          className={iconClassName ?? s.triggerIcon}
          // Inbox drew snooze as an outline clock beside otherwise filled icons.
          style={{ fontVariationSettings: "'FILL' 0" }}
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className={s.dropdown}
            style={dropdownStyle}
            role={picking ? "dialog" : "menu"}
            aria-label={picking ? "Pick date & time" : "Snooze until"}
            onClick={(e) => e.stopPropagation()}
            {...menuFocus}
          >
            {picking ? (
              <SnoozePicker
                onBack={() => setPicking(false)}
                onChoose={(wakeAt) => {
                  setLastCustomSnooze(wakeAt);
                  choose(wakeAt);
                }}
              />
            ) : (
              <>
                {/* The menu's label says this already. */}
                <div className={s.title} aria-hidden="true">Snooze until...</div>
                {snoozePresets(SNOOZE_PREFS).map(({ label, icon, wakeAt }) => (
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
                <div className={s.divider} role="separator" />
                <button
                  className={clsx(s.option, s.lastOption)}
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPicking(true);
                  }}
                >
                  <Icon name="event" className={s.optionIcon} />
                  <span className={s.optionLabel}>Pick date &amp; time</span>
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
};

type TimeChoice = TimeOfDay | "custom";

const SnoozePicker = ({
  onBack,
  onChoose,
}: {
  onBack: () => void;
  onChoose: (wakeAt: number) => void;
}) => {
  const [date, setDate] = useState(() => startOfDay(defaultCustomSnooze(SNOOZE_PREFS)));
  const [timeMenuOpen, setTimeMenuOpen] = useState(false);
  const [timeChoice, setTimeChoice] = useState<TimeChoice>("morning");
  const [customTime, setCustomTime] = useState(() => localTimeValue(SNOOZE_PREFS.times.morning));
  const [error, setError] = useState("");

  const now = new Date();
  const isToday = sameDay(date, now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  // On today, times of day already behind us can't be picked.
  const timeAvailable = (choice: TimeOfDay) => !isToday || SNOOZE_PREFS.times[choice] > nowMinutes;

  const minutes = timeChoice === "custom" ? parseTimeValue(customTime) : SNOOZE_PREFS.times[timeChoice];

  const pickDate = (next: Date) => {
    setDate(next);
    setError("");
    if (timeChoice !== "custom" && sameDay(next, now) && SNOOZE_PREFS.times[timeChoice] <= nowMinutes) {
      // Move to the next time of day still ahead, or a custom time if none is.
      const upcoming = TIMES_OF_DAY.find((t) => SNOOZE_PREFS.times[t] > nowMinutes);
      if (upcoming) setTimeChoice(upcoming);
      else {
        setTimeChoice("custom");
        setCustomTime(localTimeValue(Math.min(nowMinutes + 60, 23 * 60 + 59)));
      }
    }
  };

  const submit = () => {
    if (Number.isNaN(minutes)) {
      setError("Choose a valid time.");
      return;
    }
    const wakeAt = setMinutes(new Date(date), minutes).getTime();
    if (wakeAt <= Date.now()) {
      setError("Choose a time in the future.");
      return;
    }
    onChoose(wakeAt);
  };

  return (
    <div className={s.picker}>
      <div className={s.pickerHeader}>
        <button type="button" className={s.backBtn} title="Back" onClick={onBack}>
          <Icon name="arrow_back" />
        </button>
        <span>Pick date &amp; time</span>
      </div>
      <div className={s.pickerBody}>
        <Calendar selected={date} onPick={pickDate} />

        <div className={s.timeField}>
          <button
            type="button"
            className={clsx(s.select, timeMenuOpen && s.selectActive)}
            aria-haspopup="listbox"
            aria-expanded={timeMenuOpen}
            onClick={() => setTimeMenuOpen((o) => !o)}
          >
            {timeChoice === "custom" ? (
              <span className={s.selectValue}>Custom</span>
            ) : (
              <>
                <span className={s.selectValue}>{TIME_OF_DAY_LABELS[timeChoice]}</span>
                <span className={s.selectHint}>{formatMinutes(SNOOZE_PREFS.times[timeChoice])}</span>
              </>
            )}
            <Icon name="arrow_drop_down" className={s.selectArrow} />
          </button>
          {timeMenuOpen && (
            <div className={s.timeMenu} role="listbox" aria-label="Time">
              {TIMES_OF_DAY.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="option"
                  aria-selected={timeChoice === t}
                  disabled={!timeAvailable(t)}
                  className={clsx(s.timeOption, timeChoice === t && s.timeOptionSelected)}
                  onClick={() => {
                    setTimeChoice(t);
                    setTimeMenuOpen(false);
                    setError("");
                  }}
                >
                  <span>{TIME_OF_DAY_LABELS[t]}</span>
                  <span className={s.selectHint}>{formatMinutes(SNOOZE_PREFS.times[t])}</span>
                </button>
              ))}
              <button
                type="button"
                role="option"
                aria-selected={timeChoice === "custom"}
                className={clsx(s.timeOption, timeChoice === "custom" && s.timeOptionSelected)}
                onClick={() => {
                  if (timeChoice !== "custom" && !Number.isNaN(minutes)) {
                    setCustomTime(localTimeValue(minutes));
                  }
                  setTimeChoice("custom");
                  setTimeMenuOpen(false);
                  setError("");
                }}
              >
                <span>Custom…</span>
              </button>
            </div>
          )}
        </div>
        {timeChoice === "custom" && (
          <input
            className={s.timeInput}
            type="time"
            aria-label="Custom time"
            value={customTime}
            onChange={(e) => {
              setCustomTime(e.currentTarget.value);
              setError("");
            }}
          />
        )}
        {error && <p className={s.error}>{error}</p>}
      </div>
      <div className={s.actions}>
        <button type="button" className={s.saveBtn} onClick={submit}>
          Save
        </button>
      </div>
    </div>
  );
};

/** Material Design 1 month calendar, Sunday first like Inbox's. */
const Calendar = ({
  selected,
  onPick,
}: {
  selected: Date;
  onPick: (date: Date) => void;
}) => {
  const [month, setMonth] = useState(
    () => new Date(selected.getFullYear(), selected.getMonth(), 1),
  );
  const today = startOfDay(new Date());
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstWeekday = month.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const weekdayNames = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(new Date(2026, 1, 1 + i)),
  );
  const shiftMonth = (by: number) =>
    setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));

  return (
    <div className={s.calendar}>
      <div className={s.calendarHeader}>
        <button
          type="button"
          className={s.calendarNav}
          title="Previous month"
          disabled={month <= thisMonth}
          onClick={() => shiftMonth(-1)}
        >
          <Icon name="chevron_left" />
        </button>
        <span className={s.calendarMonth}>
          {new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(month)}
        </span>
        <button
          type="button"
          className={s.calendarNav}
          title="Next month"
          onClick={() => shiftMonth(1)}
        >
          <Icon name="chevron_right" />
        </button>
      </div>
      <div className={s.calendarGrid} role="grid">
        {weekdayNames.map((name, i) => (
          <span key={i} className={s.weekday}>{name}</span>
        ))}
        {Array.from({ length: firstWeekday }, (_, i) => (
          <span key={`pad-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = new Date(month.getFullYear(), month.getMonth(), i + 1);
          const isSelected = sameDay(day, selected);
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              disabled={day < today}
              className={clsx(
                s.day,
                sameDay(day, today) && s.dayToday,
                isSelected && s.daySelected,
              )}
              onClick={() => onPick(day)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
};

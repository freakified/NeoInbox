import {
  getLastCustomSnooze,
  getSnoozePrefs,
  type SnoozePrefs,
} from "./snoozePrefs";

export interface SnoozePreset {
  label: string;
  icon: string;
  wakeAt: number;
}

export const setMinutes = (date: Date, minutes: number): Date => {
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
};

const nextDayOfWeek = (now: Date, day: number, minutes: number): Date => {
  const date = new Date(now);
  const daysUntil = (day - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + daysUntil);
  setMinutes(date, minutes);
  if (date.getTime() <= now.getTime()) date.setDate(date.getDate() + 7);
  return date;
};

export const snoozePresets = (
  prefs: SnoozePrefs = getSnoozePrefs(),
  lastCustom: number | null = getLastCustomSnooze(),
): SnoozePreset[] => {
  const now = new Date();
  const { morning, evening } = prefs.times;
  // The week starts the day after the two-day weekend ends; `dayOfWeek` counts
  // from there (0 = first workday, 5 and 6 = the weekend).
  const weekStart = (prefs.weekendStart + 2) % 7;
  const dayOfWeek = (now.getDay() - weekStart + 7) % 7;
  const presets: SnoozePreset[] = [];

  // Only offer "Later today" while evening is still comfortably ahead; past
  // that the label would silently mean tomorrow evening.
  const laterToday = setMinutes(new Date(now), evening);
  if (laterToday.getTime() - now.getTime() >= 2 * 60 * 60 * 1000) {
    presets.push({ label: "Later today", icon: "brightness_medium", wakeAt: laterToday.getTime() });
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  setMinutes(tomorrow, morning);
  presets.push({ label: "Tomorrow", icon: "light_mode", wakeAt: tomorrow.getTime() });

  // Midweek only reads as "later this week" from the week's first day or the
  // day before; from the second day on it is either just "tomorrow" or
  // already next week.
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    presets.push({
      label: "Later this week",
      icon: "work",
      wakeAt: nextDayOfWeek(now, (weekStart + 2) % 7, morning).getTime(),
    });
  }

  // Hide "This weekend" once the weekend has started.
  if (dayOfWeek <= 4) {
    presets.push({
      label: "This weekend",
      icon: "weekend",
      wakeAt: nextDayOfWeek(now, prefs.weekendStart, morning).getTime(),
    });
  }

  presets.push({
    label: "Next week",
    icon: "next_week",
    wakeAt: nextDayOfWeek(now, weekStart, morning).getTime(),
  });

  // Inbox offered the last hand-picked time back until it passed.
  if (lastCustom !== null && lastCustom > now.getTime()) {
    presets.push({ label: "Last snooze", icon: "history", wakeAt: lastCustom });
  }

  // Drop entries that collapse into an earlier one (e.g. on Sunday
  // "Next week" is Monday morning — the same moment as "Tomorrow").
  const seen = new Set<number>();
  return presets.filter((preset) => {
    if (seen.has(preset.wakeAt)) return false;
    seen.add(preset.wakeAt);
    return true;
  });
};

export const defaultCustomSnooze = (prefs: SnoozePrefs = getSnoozePrefs()): Date => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return setMinutes(date, prefs.times.morning);
};

export const formatSnoozeOptionTime = (wakeAt: number): string => {
  const wake = new Date(wakeAt);
  const now = new Date();
  const sameDay =
    wake.getFullYear() === now.getFullYear() &&
    wake.getMonth() === now.getMonth() &&
    wake.getDate() === now.getDate();

  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(wake);

  if (sameDay) return time;

  // Past a week the weekday alone is ambiguous.
  if (wakeAt - now.getTime() > 6 * 24 * 60 * 60 * 1000) {
    const date = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(wake);
    return `${date}, ${time}`;
  }

  const weekday = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
  }).format(wake);
  return `${weekday}, ${time}`;
};

export const formatSnoozeToastTime = (wakeAt: number): string => {
  // Past a week the weekday alone is ambiguous.
  const farOff = Math.abs(wakeAt - Date.now()) > 6 * 24 * 60 * 60 * 1000;
  return new Intl.DateTimeFormat(undefined, {
    ...(farOff ? { month: "short", day: "numeric" } : { weekday: "short" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(wakeAt));
};

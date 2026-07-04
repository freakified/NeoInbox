export interface SnoozePreset {
  label: string;
  icon: string;
  wakeAt: number;
}

const setTime = (date: Date, hour: number, minute = 0): Date => {
  date.setHours(hour, minute, 0, 0);
  return date;
};

const nextDayOfWeek = (now: Date, day: number, hour: number): Date => {
  const date = new Date(now);
  const daysUntil = (day - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + daysUntil);
  setTime(date, hour);
  if (date.getTime() <= now.getTime()) date.setDate(date.getDate() + 7);
  return date;
};

export const snoozePresets = (): SnoozePreset[] => {
  const now = new Date();
  const day = now.getDay();
  const presets: SnoozePreset[] = [];

  // Only offer "Later today" while 6 PM is still comfortably ahead; past
  // that the label would silently mean tomorrow evening.
  const laterToday = setTime(new Date(now), 18);
  if (laterToday.getTime() - now.getTime() >= 2 * 60 * 60 * 1000) {
    presets.push({ label: "Later today", icon: "schedule", wakeAt: laterToday.getTime() });
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  setTime(tomorrow, 8);
  presets.push({ label: "Tomorrow", icon: "schedule", wakeAt: tomorrow.getTime() });

  // Wednesday only reads as "later this week" from Sunday or Monday; from
  // Tuesday on it is either just "tomorrow" or already next week.
  if (day === 0 || day === 1) {
    presets.push({
      label: "Later this week",
      icon: "work",
      wakeAt: nextDayOfWeek(now, 3, 8).getTime(),
    });
  }

  // Hide "This weekend" once the weekend has started.
  if (day >= 1 && day <= 5) {
    presets.push({
      label: "This weekend",
      icon: "weekend",
      wakeAt: nextDayOfWeek(now, 6, 8).getTime(),
    });
  }

  presets.push({
    label: "Next week",
    icon: "next_week",
    wakeAt: nextDayOfWeek(now, 1, 8).getTime(),
  });

  // Drop entries that collapse into an earlier one (e.g. on Sunday
  // "Next week" is Monday 8 AM — the same moment as "Tomorrow").
  const seen = new Set<number>();
  return presets.filter((preset) => {
    if (seen.has(preset.wakeAt)) return false;
    seen.add(preset.wakeAt);
    return true;
  });
};

export const defaultCustomSnooze = (): Date => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return setTime(date, 8);
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

  const weekday = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
  }).format(wake);
  return `${weekday}, ${time}`;
};

export const formatSnoozeToastTime = (wakeAt: number): string => {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(wakeAt));
};

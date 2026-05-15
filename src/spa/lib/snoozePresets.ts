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

  const laterToday = setTime(new Date(now), 18);
  if (laterToday.getTime() <= now.getTime()) {
    laterToday.setDate(laterToday.getDate() + 1);
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  setTime(tomorrow, 8);

  const laterThisWeek = nextDayOfWeek(now, 3, 8);
  const thisWeekend = nextDayOfWeek(now, 6, 8);
  const nextWeek = nextDayOfWeek(now, 1, 8);

  return [
    { label: "Later today", icon: "schedule", wakeAt: laterToday.getTime() },
    { label: "Tomorrow", icon: "schedule", wakeAt: tomorrow.getTime() },
    { label: "Later this week", icon: "work", wakeAt: laterThisWeek.getTime() },
    { label: "This weekend", icon: "weekend", wakeAt: thisWeekend.getTime() },
    { label: "Next week", icon: "next_week", wakeAt: nextWeek.getTime() },
  ];
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

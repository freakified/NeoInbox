const LAST_SNOOZE_KEY = "neoinbox.lastCustomSnooze";

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

/** Minutes after midnight. */
export type DayTimes = Record<TimeOfDay, number>;

/**
 * What "morning", "afternoon", "evening" and "night" mean, and which two days
 * make up the weekend; every preset is built from these.
 */
export interface SnoozePrefs {
  times: DayTimes;
  /** First day of the two-day weekend, 0 = Sunday … 6 = Saturday. */
  weekendStart: number;
}

export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};

export const TIMES_OF_DAY: readonly TimeOfDay[] = ["morning", "afternoon", "evening", "night"];

export const SNOOZE_PREFS: SnoozePrefs = {
  times: { morning: 8 * 60, afternoon: 13 * 60, evening: 18 * 60, night: 20 * 60 },
  weekendStart: 6,
};

/**
 * The last date & time picked by hand, which Inbox offered back as a quick
 * option until it passed.
 */
export const getLastCustomSnooze = (): number | null => {
  try {
    const v = Number(localStorage.getItem(LAST_SNOOZE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};

export const setLastCustomSnooze = (wakeAt: number): void => {
  try {
    localStorage.setItem(LAST_SNOOZE_KEY, String(wakeAt));
  } catch {
    // Storage unavailable; nothing to offer back next time.
  }
};

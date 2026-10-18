import { useSyncExternalStore } from "react";

const SNOOZE_PREFS_KEY = "neoinbox.snoozePrefs";
const LAST_SNOOZE_KEY = "neoinbox.lastCustomSnooze";
const SNOOZE_PREFS_EVENT = "neoinbox:snooze-prefs";

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

/** Minutes after midnight. */
export type DayTimes = Record<TimeOfDay, number>;

/**
 * Inbox let you set what "morning", "afternoon", "evening" and "night" mean,
 * and which two days make up your weekend; every preset is built from these.
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

export const DEFAULT_SNOOZE_PREFS: SnoozePrefs = {
  times: { morning: 8 * 60, afternoon: 13 * 60, evening: 18 * 60, night: 20 * 60 },
  weekendStart: 6,
};

const isMinutes = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 24 * 60;

let cached: { raw: string | null; prefs: SnoozePrefs } | null = null;

export const getSnoozePrefs = (): SnoozePrefs => {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SNOOZE_PREFS_KEY);
  } catch {
    return DEFAULT_SNOOZE_PREFS;
  }
  // useSyncExternalStore needs a stable snapshot between changes.
  if (cached && cached.raw === raw) return cached.prefs;
  let prefs = DEFAULT_SNOOZE_PREFS;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<SnoozePrefs>) : null;
    if (parsed) {
      const times = { ...DEFAULT_SNOOZE_PREFS.times };
      for (const key of TIMES_OF_DAY) {
        const v = parsed.times?.[key];
        if (isMinutes(v)) times[key] = v;
      }
      const weekendStart =
        Number.isInteger(parsed.weekendStart) && parsed.weekendStart! >= 0 && parsed.weekendStart! <= 6
          ? parsed.weekendStart!
          : DEFAULT_SNOOZE_PREFS.weekendStart;
      prefs = { times, weekendStart };
    }
  } catch {
    // Corrupt pref; fall back to defaults.
  }
  cached = { raw, prefs };
  return prefs;
};

export const setSnoozePrefs = (prefs: SnoozePrefs): void => {
  try {
    localStorage.setItem(SNOOZE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable; the choice just won't stick.
  }
  window.dispatchEvent(new Event(SNOOZE_PREFS_EVENT));
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

const subscribe = (callback: () => void): (() => void) => {
  window.addEventListener(SNOOZE_PREFS_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(SNOOZE_PREFS_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
};

export const useSnoozePrefs = (): SnoozePrefs =>
  useSyncExternalStore(subscribe, getSnoozePrefs);

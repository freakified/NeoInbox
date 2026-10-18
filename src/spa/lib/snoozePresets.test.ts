import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCustomSnooze, formatSnoozeOptionTime, snoozePresets } from "./snoozePresets";
import { SNOOZE_PREFS, type SnoozePrefs } from "./snoozePrefs";

const at = (iso: string) => vi.setSystemTime(new Date(iso));
const labels = () => snoozePresets().map((preset) => preset.label);
const wakeFor = (label: string) => {
  const preset = snoozePresets().find((p) => p.label === label);
  return preset ? new Date(preset.wakeAt) : null;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("snoozePresets", () => {
  it("offers 'Later today' when 6 PM is still comfortably ahead", () => {
    at("2026-07-29T09:00:00"); // Wednesday morning
    expect(labels()).toContain("Later today");
    expect(wakeFor("Later today")!.getHours()).toBe(18);
  });

  it("drops 'Later today' inside the two-hour cutoff", () => {
    at("2026-07-29T16:30:00");
    expect(labels()).not.toContain("Later today");
  });

  it("always offers tomorrow at 8 AM", () => {
    at("2026-07-29T09:00:00");
    const tomorrow = wakeFor("Tomorrow")!;
    expect(tomorrow.getDate()).toBe(30);
    expect(tomorrow.getHours()).toBe(8);
  });

  it("offers 'Later this week' only on Sunday and Monday", () => {
    at("2026-07-27T09:00:00"); // Monday
    expect(labels()).toContain("Later this week");
    expect(wakeFor("Later this week")!.getDay()).toBe(3); // Wednesday

    at("2026-07-29T09:00:00"); // Wednesday
    expect(labels()).not.toContain("Later this week");
  });

  it("hides 'This weekend' once the weekend has started", () => {
    at("2026-07-29T09:00:00"); // Wednesday
    expect(labels()).toContain("This weekend");
    expect(wakeFor("This weekend")!.getDay()).toBe(6);

    at("2026-08-01T09:00:00"); // Saturday
    expect(labels()).not.toContain("This weekend");
  });

  it("folds 'This weekend' into 'Tomorrow' on a Friday", () => {
    at("2026-07-31T09:00:00"); // Friday — Saturday 8 AM is just "Tomorrow"
    expect(labels()).toContain("Tomorrow");
    expect(labels()).not.toContain("This weekend");
  });

  it("points 'Next week' at the coming Monday", () => {
    at("2026-07-29T09:00:00"); // Wednesday
    const next = wakeFor("Next week")!;
    expect(next.getDay()).toBe(1);
    expect(next.getDate()).toBe(3); // Mon 3 Aug
  });

  it("never offers two presets for the same moment", () => {
    // Sunday: "Next week" (Mon 8 AM) collapses into "Tomorrow".
    at("2026-08-02T09:00:00");
    const wakes = snoozePresets().map((preset) => preset.wakeAt);
    expect(new Set(wakes).size).toBe(wakes.length);
  });

  it("keeps every preset strictly in the future", () => {
    for (const iso of ["2026-07-27T00:30:00", "2026-07-29T17:59:00", "2026-08-01T23:45:00"]) {
      at(iso);
      const now = Date.now();
      for (const preset of snoozePresets()) {
        expect(preset.wakeAt, `${preset.label} at ${iso}`).toBeGreaterThan(now);
      }
    }
  });
});

describe("snoozePresets with custom prefs", () => {
  const prefs = (over: Partial<SnoozePrefs>): SnoozePrefs => ({ ...SNOOZE_PREFS, ...over });

  it("uses the configured morning and evening times", () => {
    at("2026-07-29T09:00:00");
    const p = prefs({ times: { ...SNOOZE_PREFS.times, morning: 7 * 60 + 30, evening: 17 * 60 } });
    const presets = snoozePresets(p, null);
    const later = new Date(presets.find((x) => x.label === "Later today")!.wakeAt);
    const tomorrow = new Date(presets.find((x) => x.label === "Tomorrow")!.wakeAt);
    expect([later.getHours(), later.getMinutes()]).toEqual([17, 0]);
    expect([tomorrow.getHours(), tomorrow.getMinutes()]).toEqual([7, 30]);
  });

  it("follows a Friday–Saturday weekend", () => {
    at("2026-07-26T09:00:00"); // Sunday: the first workday of that week
    const presets = snoozePresets(prefs({ weekendStart: 5 }), null);
    const byLabel = (l: string) => new Date(presets.find((x) => x.label === l)!.wakeAt);
    expect(byLabel("Later this week").getDay()).toBe(2); // Tuesday
    expect(byLabel("This weekend").getDay()).toBe(5); // Friday
    expect(byLabel("Next week").getDay()).toBe(0); // Sunday
  });

  it("offers the last hand-picked time until it passes", () => {
    at("2026-07-29T09:00:00");
    const last = new Date("2026-08-12T15:00:00").getTime();
    expect(snoozePresets(SNOOZE_PREFS, last).at(-1)).toMatchObject({
      label: "Last snooze",
      wakeAt: last,
    });
    at("2026-08-12T15:01:00");
    expect(snoozePresets(SNOOZE_PREFS, last).map((x) => x.label)).not.toContain("Last snooze");
  });

  it("drops the last snooze when it matches a preset", () => {
    at("2026-07-29T09:00:00");
    const tomorrow = new Date("2026-07-30T08:00:00").getTime();
    expect(snoozePresets(SNOOZE_PREFS, tomorrow).map((x) => x.label)).not.toContain("Last snooze");
  });
});

describe("formatSnoozeOptionTime", () => {
  it("shows the date rather than the weekday beyond a week out", () => {
    at("2026-07-29T09:00:00");
    expect(formatSnoozeOptionTime(new Date("2026-08-12T15:00:00").getTime())).toMatch(/Aug/);
    expect(formatSnoozeOptionTime(new Date("2026-07-31T15:00:00").getTime())).toMatch(/Fri/);
  });
});

describe("defaultCustomSnooze", () => {
  it("lands on tomorrow at 8 AM", () => {
    at("2026-07-29T22:15:00");
    const date = defaultCustomSnooze();
    expect(date.getDate()).toBe(30);
    expect(date.getHours()).toBe(8);
    expect(date.getMinutes()).toBe(0);
  });
});

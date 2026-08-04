import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCustomSnooze, snoozePresets } from "./snoozePresets";

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

describe("defaultCustomSnooze", () => {
  it("lands on tomorrow at 8 AM", () => {
    at("2026-07-29T22:15:00");
    const date = defaultCustomSnooze();
    expect(date.getDate()).toBe(30);
    expect(date.getHours()).toBe(8);
    expect(date.getMinutes()).toBe(0);
  });
});

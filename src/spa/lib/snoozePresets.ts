export interface SnoozePreset {
  label: string;
  wakeAt: number;
}

export function snoozePresets(): SnoozePreset[] {
  const now = Date.now();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + ((8 - nextWeek.getDay()) % 7 || 7));
  nextWeek.setHours(9, 0, 0, 0);
  return [
    { label: "1 hour", wakeAt: now + 3_600_000 },
    { label: "3 hours", wakeAt: now + 10_800_000 },
    { label: "Tomorrow 9 am", wakeAt: tomorrow.getTime() },
    { label: "Next week", wakeAt: nextWeek.getTime() },
  ];
}

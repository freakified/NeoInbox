export const isSameDay = (a: Date, b: Date): boolean => {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export const dateBucket = (epochMs: number): string => {
  const d = new Date(epochMs);
  const now = new Date();
  if (isSameDay(d, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return "Yesterday";
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);
  if (d >= weekStart) return "This week";
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(weekStart.getDate() - 7);
  if (d >= lastWeekStart) return "Last week";
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  if (d >= monthStart) return "This month";
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString("en-US", { month: "long" });
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export const futureDateBucket = (epochMs: number): string => {
  const d = new Date(epochMs);
  const now = new Date();
  if (isSameDay(d, now)) return "Today";
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (isSameDay(d, tomorrow)) return "Tomorrow";

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);
  const nextWeekStart = new Date(weekStart);
  nextWeekStart.setDate(weekStart.getDate() + 7);
  const followingWeekStart = new Date(nextWeekStart);
  followingWeekStart.setDate(nextWeekStart.getDate() + 7);

  if (d < nextWeekStart) return "This week";
  if (d < followingWeekStart) return "Next week";

  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  if (d < nextMonthStart) return "This month";
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString("en-US", { month: "long" });
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export const groupByBucket = <T>(
  items: readonly T[],
  getDate: (item: T) => number,
): { label: string; items: T[] }[] => {
  const groups: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = dateBucket(getDate(item));
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export const formatDate = (epochMs: number): string => {
  if (!epochMs) return "";
  const d = new Date(epochMs);
  const now = new Date();
  return isSameDay(d, now)
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

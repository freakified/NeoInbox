/** How far back an archive import or trip scan reaches; null is everything. */
export interface ArchiveRange {
  label: string;
  years: number | null;
}

const YEAR = 365 * 24 * 60 * 60 * 1000;
/** Matches the background's slack: "2 years" asked a month later is the same range. */
const SLACK = 30 * 24 * 60 * 60 * 1000;

export const ARCHIVE_RANGES: ArchiveRange[] = [
  { label: "Last year", years: 1 },
  { label: "Last 2 years", years: 2 },
  { label: "Last 5 years", years: 5 },
  { label: "Everything", years: null },
];

export const DEFAULT_ARCHIVE_YEARS = 2;

export const sinceOf = (years: number | null, now = Date.now()): number | null =>
  years === null ? null : now - years * YEAR;

/**
 * The ranges that would reach further back than `covered` (undefined: nothing
 * yet, null: everything already).
 */
export const rangesBeyond = (covered: number | null | undefined, now = Date.now()): ArchiveRange[] => {
  if (covered === undefined) return ARCHIVE_RANGES;
  if (covered === null) return [];
  return ARCHIVE_RANGES.filter((r) => r.years === null || sinceOf(r.years, now)! < covered - SLACK);
};

export const formatDay = (ms: number): string =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

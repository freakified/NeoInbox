/**
 * Text-level parsing helpers shared by the per-sender extractors. Reservation
 * emails are parsed from their plain-text rendering: airline HTML is machine-
 * generated soup, but the visible text (dates, airport codes, confirmation
 * numbers) is far more stable than the markup around it.
 */

/** Extractors only scan this much text; itinerary data is always near the top. */
const MAX_SCAN_CHARS = 40_000;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rarr: "→",
  bull: "•",
  middot: "·",
};

const decodeEntities = (s: string): string =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) {
      const code = parseInt(name.slice(2), 16);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
    }
    if (name.startsWith("#")) {
      const code = parseInt(name.slice(1), 10);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });

/**
 * Crude but dependency-free HTML → text. Block-level closers become line
 * breaks so "labels" and their values stay on adjacent lines, which the
 * date/code context patterns rely on.
 */
export const htmlToText = (html: string): string =>
  decodeEntities(
    html
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|hr)\b[^>]*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|td|th|li|h[1-6]|table|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, MAX_SCAN_CHARS);

// ─── dates ──────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const monthOf = (name: string): number | undefined =>
  MONTHS[name.slice(0, 3).toLowerCase()];

export interface FoundDate {
  /** Local midnight of the found calendar date (ms). */
  date: number;
  /** Character offset in the scanned text, for nearest-neighbor pairing. */
  index: number;
}

/** "Aug 12, 2026" / "August 12" / "Sat, Aug 12" — year optional. */
const MDY_RE =
  /\b(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi;
/** "12 Aug 2026" / "12 August" — year optional. */
const DMY_RE =
  /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?\b/gi;
/** "2026/08/12", "2026-08-12" (ZipAir and JAL favor ISO-ish forms). */
const YMD_RE = /\b(20\d{2})[/-](\d{1,2})[/-](\d{1,2})\b/g;
/** "08/12/2026" — US order; only trusted with a full 4-digit year. */
const MDY_SLASH_RE = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g;
/** "12AUG26" / "12AUG2026" — airline ticket shorthand (JAL, GDS dumps). */
const COMPACT_RE = /\b(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2}|\d{4})?\b/g;

const msOf = (y: number, m: number, d: number): number | null => {
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  const date = new Date(y, m, d);
  // new Date() rolls over invalid days (Feb 31 → Mar 3); reject those.
  return date.getMonth() === m && date.getDate() === d ? date.getTime() : null;
};

/**
 * A body date with no year means the current booking cycle: same year as the
 * message, or the next one if that would put the reservation implausibly far
 * in the past (a January email about a February-of-next-year flight).
 */
const inferYear = (m: number, d: number, messageDate: number): number => {
  const msg = new Date(messageDate);
  const sameYear = new Date(msg.getFullYear(), m, d).getTime();
  const slack = 45 * 24 * 60 * 60 * 1000;
  return sameYear < messageDate - slack ? msg.getFullYear() + 1 : msg.getFullYear();
};

/** Reject nonsense: reservations live near the email, not years around it. */
const plausible = (date: number, messageDate: number): boolean => {
  const past = 60 * 24 * 60 * 60 * 1000;
  const future = 550 * 24 * 60 * 60 * 1000;
  return date >= messageDate - past && date <= messageDate + future;
};

/** Every calendar date in the text, in order of appearance, deduped by offset. */
export const findDates = (text: string, messageDate: number): FoundDate[] => {
  const out: FoundDate[] = [];
  const push = (index: number, y: number | undefined, m: number, d: number): void => {
    const year = y ?? inferYear(m, d, messageDate);
    const ms = msOf(year, m, d);
    if (ms !== null && plausible(ms, messageDate)) out.push({ date: ms, index });
  };
  for (const match of text.matchAll(MDY_RE)) {
    const m = monthOf(match[1] ?? "");
    if (m === undefined) continue;
    push(match.index, match[3] ? Number(match[3]) : undefined, m, Number(match[2]));
  }
  for (const match of text.matchAll(DMY_RE)) {
    const m = monthOf(match[2] ?? "");
    if (m === undefined) continue;
    push(match.index, match[3] ? Number(match[3]) : undefined, m, Number(match[1]));
  }
  for (const match of text.matchAll(YMD_RE)) {
    push(match.index, Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  for (const match of text.matchAll(MDY_SLASH_RE)) {
    push(match.index, Number(match[3]), Number(match[1]) - 1, Number(match[2]));
  }
  for (const match of text.matchAll(COMPACT_RE)) {
    const m = monthOf(match[2] ?? "");
    if (m === undefined) continue;
    const rawYear = match[3];
    const y =
      rawYear === undefined
        ? undefined
        : rawYear.length === 2
          ? 2000 + Number(rawYear)
          : Number(rawYear);
    push(match.index, y, m, Number(match[1]));
  }
  const seen = new Set<number>();
  return out
    .sort((a, b) => a.index - b.index)
    .filter((f) => (seen.has(f.index) ? false : (seen.add(f.index), true)));
};

export const dateSpan = (dates: readonly FoundDate[]): { start: number; end: number } | null => {
  if (!dates.length) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const f of dates) {
    if (f.date < start) start = f.date;
    if (f.date > end) end = f.date;
  }
  return { start, end };
};

// ─── confirmation codes ─────────────────────────────────────────────────────

/**
 * Codes are only trusted next to a context label — a bare 6-char token
 * matches half the words in an email. The label list covers airline record
 * locators, hotel/OTA confirmation numbers, and Amtrak reservations.
 */
const CODE_CONTEXT_RE =
  /\b(?:confirmation|conf|booking|reservation|record\s+locator|itinerary|pnr|order|e-?ticket)(?:\s+(?:number|code|reference|ref|no|id))?\s*(?:number|code|#)?\s*[:#\-–]?\s*([A-Z0-9]{5,13})\b/gi;

/** Uppercase words that slip past the context pattern. */
const CODE_STOPWORDS = new Set([
  "NUMBER", "ONLINE", "BELOW", "EMAIL", "PLEASE", "STATUS", "DETAILS",
  "CONFIRM", "CHECKIN", "TICKET", "FLIGHT", "TRAVEL", "POLICY", "CENTER",
  "BOOKED", "CHANGE", "CANCEL", "REVIEW", "COMING", "THANKS", "WITHIN",
]);

const looksLikeCode = (token: string): boolean => {
  if (CODE_STOPWORDS.has(token)) return false;
  const hasDigit = /\d/.test(token);
  const hasAlpha = /[A-Z]/.test(token);
  // Airline PNRs: 6 alnum. Amtrak: 6. Airbnb: 10 mixed ("HMABC123XY").
  // Hotels/OTAs: longer, usually numeric.
  if (hasDigit && hasAlpha) return token.length >= 5 && token.length <= 12;
  if (hasDigit) return token.length >= 6 && token.length <= 13;
  return token.length === 6; // all-letters record locators are exactly 6
};

export const findConfirmationCodes = (text: string): string[] => {
  const out = new Set<string>();
  for (const match of text.matchAll(CODE_CONTEXT_RE)) {
    const token = (match[1] ?? "").toUpperCase();
    if (looksLikeCode(token)) out.add(token);
  }
  return [...out];
};

// ─── misc ───────────────────────────────────────────────────────────────────

export const CANCEL_RE = /\b(cancell?ed|cancellation)\b/i;

/** The nearest found date at-or-after a text offset, else the nearest before. */
export const dateNear = (dates: readonly FoundDate[], index: number): FoundDate | null => {
  let after: FoundDate | null = null;
  let before: FoundDate | null = null;
  for (const f of dates) {
    if (f.index >= index) {
      if (!after || f.index < after.index) after = f;
    } else if (!before || f.index > before.index) {
      before = f;
    }
  }
  return after ?? before;
};

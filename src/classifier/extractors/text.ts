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
  /** Length of the matched date text. */
  length: number;
}

/** "Aug 12, 2026" / "August 12" / "Sat, Aug 12" / "Mar-16-2021" — year optional. */
const MDY_RE =
  /\b(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+|-)(\d{1,2})(?:st|nd|rd|th)?(?:(?:,?\s+|-)(\d{4}))?\b/gi;
/** "12 Aug 2026" / "12 August" — year optional. */
const DMY_RE =
  /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?\b/gi;
/** "2026/08/12", "2026-08-12" (ZipAir and JAL favor ISO-ish forms). */
const YMD_RE = /\b(20\d{2})[/-](\d{1,2})[/-](\d{1,2})\b/g;
/** "08/12/2026" — US order; only trusted with a full 4-digit year. */
const MDY_SLASH_RE = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g;
/** "7/14/22" — US order, two-digit year (Spirit's check-in mail). */
const MDY_SHORT_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b(?![/\d])/g;
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
  let length = 0;
  const push = (index: number, y: number | undefined, m: number, d: number): void => {
    const year = y ?? inferYear(m, d, messageDate);
    const ms = msOf(year, m, d);
    if (ms !== null && plausible(ms, messageDate)) out.push({ date: ms, index, length });
  };
  for (const match of text.matchAll(MDY_RE)) {
    length = match[0].length;
    const m = monthOf(match[1] ?? "");
    if (m === undefined) continue;
    push(match.index, match[3] ? Number(match[3]) : undefined, m, Number(match[2]));
  }
  for (const match of text.matchAll(DMY_RE)) {
    length = match[0].length;
    const m = monthOf(match[2] ?? "");
    if (m === undefined) continue;
    push(match.index, match[3] ? Number(match[3]) : undefined, m, Number(match[1]));
  }
  for (const match of text.matchAll(YMD_RE)) {
    length = match[0].length;
    push(match.index, Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  for (const match of text.matchAll(MDY_SLASH_RE)) {
    length = match[0].length;
    push(match.index, Number(match[3]), Number(match[1]) - 1, Number(match[2]));
  }
  for (const match of text.matchAll(MDY_SHORT_RE)) {
    length = match[0].length;
    push(match.index, 2000 + Number(match[3]), Number(match[1]) - 1, Number(match[2]));
  }
  for (const match of text.matchAll(COMPACT_RE)) {
    length = match[0].length;
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

/** "Your 08/07 trip" — subjects abbreviate to MM/DD; year from the message. */
const SUBJECT_MD_RE = /(?<![/\d])(\d{1,2})\/(\d{1,2})(?![/\d])/g;

/** Dates a subject line names, for mail whose body never states one. */
export const findSubjectDates = (subject: string, messageDate: number): number[] => {
  const out = findDates(subject, messageDate).map((f) => f.date);
  for (const match of subject.matchAll(SUBJECT_MD_RE)) {
    const m = Number(match[1]) - 1;
    const d = Number(match[2]);
    const ms = msOf(inferYear(m, d, messageDate), m, d);
    if (ms !== null && plausible(ms, messageDate)) out.push(ms);
  }
  return out;
};

// ─── confirmation codes ─────────────────────────────────────────────────────

/**
 * Codes are only trusted next to a context label — a bare 6-char token
 * matches half the words in an email. The label list covers airline record
 * locators, hotel/OTA confirmation numbers, and Amtrak reservations. The
 * separator allows a table cell boundary ("Confirmation # | 7HD3KR"). The
 * code sits in a lookahead so a rejected one isn't consumed: in "Full
 * itinerary\nConfirmation # 7HD3KR" the word "Confirmation" is first read as
 * itinerary's code, and must stay available to start the real match.
 */
const CODE_CONTEXT_RE =
  /\b(?:confirmation|conf|booking|reservation|record\s+locator|itinerary|pnr|order|e-?ticket|reference)(?:\s+(?:number|code|reference|ref|no|id))?\s*(?:number|code|#|no\.?)?(?:\s*[:#\-–|]\s*|\s+)(?:is\s+)?(?=([A-Z0-9]+(?:-[A-Z0-9]+)*)(?![A-Za-z0-9]))/gi;

/** "Your trip (XK4PLM)" / "… on 08/19 (482XWJ)!" — locators subjects carry. */
const SUBJECT_PAREN_RE = /\(([A-Z0-9]{6})\)/g;
/** "… Las Vegas trip 9TF27Q." — a bare 6-char letters+digits token. */
const SUBJECT_LOCATOR_RE = /(?<![A-Za-z0-9])((?=[A-Z]*\d)(?=\d*[A-Z])[A-Z0-9]{6})(?![A-Za-z0-9])/g;

/** Uppercase words that slip past the context pattern. */
const CODE_STOPWORDS = new Set([
  "NUMBER", "ONLINE", "BELOW", "EMAIL", "EMAILS", "PLEASE", "STATUS", "DETAILS",
  "CONFIRM", "CHECKIN", "TICKET", "FLIGHT", "TRAVEL", "POLICY", "CENTER",
  "BOOKED", "CHANGE", "CANCEL", "REVIEW", "COMING", "THANKS", "WITHIN",
  "BEFORE", "ISSUED", "RECORD", "SYSTEM", "PICKUP", "PLACED", "PRICES",
  "LOOKUP", "SHOULD", "DATE", "CODE", "TOTAL", "SUMMARY", "RECEIPT",
  "CONFIRMED", "PENDING", "UPDATE", "CHANGED", "REQUEST", "AMOUNT",
]);

const looksLikeCode = (token: string): boolean => {
  if (CODE_STOPWORDS.has(token)) return false;
  const bare = token.replace(/-/g, "");
  if (bare.length > 24) return false;
  const hasDigit = /\d/.test(bare);
  const hasAlpha = /[A-Z]/.test(bare);
  // Airline PNRs: 6 alnum. Amtrak: 6. Airbnb: 10 mixed ("HMABC123XY").
  // Hotels/OTAs: longer, usually numeric, sometimes dash-grouped.
  if (hasDigit && hasAlpha) return bare.length >= 5;
  if (hasDigit) return bare.length >= 6;
  return bare.length === 6 && token === bare; // all-letter locators: exactly 6
};

/**
 * Every labeled code in the text. The label matches case-insensitively but
 * the code itself must be printed in capitals: "confirming", "should",
 * "emails" are prose that happens to follow the word "confirmation".
 */
export const findConfirmationCodes = (text: string, subject = ""): string[] => {
  const out = new Set<string>();
  for (const source of [subject, text]) {
    for (const match of source.matchAll(CODE_CONTEXT_RE)) {
      const token = match[1] ?? "";
      if (token !== token.toUpperCase()) continue;
      if (looksLikeCode(token)) out.add(token);
    }
  }
  for (const match of subject.matchAll(SUBJECT_LOCATOR_RE)) out.add(match[1] ?? "");
  for (const match of subject.matchAll(SUBJECT_PAREN_RE)) {
    const token = match[1] ?? "";
    if (looksLikeCode(token) && !/^\d+$/.test(token)) out.add(token);
  }
  return [...out];
};

// ─── misc ───────────────────────────────────────────────────────────────────

export const CANCEL_RE = /\b(cancell?ed|cancellation)\b/i;

/** Dates on these lines are about the purchase or the email, not the trip. */
export const NON_TRAVEL_DATE_RE =
  /\b(issued|issue date|booking date|booked|confirmation date|date of purchase|purchase[ds]?|payment|paid|charged|expir|offer|ends|arriv|valid|birth|since|copyright|sent|updated|refund|credit|deadline|cancel by|reserved on|order #|order date|ordered)\b|©/i;

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

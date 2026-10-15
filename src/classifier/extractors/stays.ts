/**
 * Stays and rentals: hotels, home shares, campsites, rental cars. All of
 * them print a start and an end under labels — "Check-in" / "Check-out",
 * "Arrive" / "Depart", "Pick-up time" / "Return time", "Trip start" / "Trip
 * end" — with the date beside the label, in the next cell, under it in the
 * next row (column tables), or on the following line (stacked cards). The
 * layout lines make each of those a short, exact lookup instead of "the
 * nearest date somewhere after the word check-in".
 */
import type { ReservationKind, ReservationSegment } from "../../shared/types";
import type { Line } from "./layout";
import type { Extraction, Extractor, ExtractorInput } from "./types";
import { CANCEL_RE, findConfirmationCodes, findDates } from "./text";

interface SpanLabels {
  start: RegExp;
  end: RegExp;
}

const LODGING_LABELS: SpanLabels = {
  start: /^(?:check[- ]?in(?:\s+date)?|arriv(?:e|al|ing)(?:\s+date)?)\b/i,
  end: /^(?:check[- ]?out(?:\s+date)?|depart(?:s|ure|ing)?(?:\s+date)?)\b/i,
};

const RENTAL_LABELS: SpanLabels = {
  start: /^(?:pick[- ]?up(?:\s+(?:time|date))?|(?:trip|rental)\s+start|starts?)\b/i,
  end: /^(?:return(?:\s+(?:time|date))?|drop[- ]?off(?:\s+(?:time|date))?|(?:trip|rental)\s+end|ends?)\b/i,
};

/**
 * A label inside a run-on paragraph: "Starts : Wednesday, 26 October 2022",
 * "Check-in begins at 03:00 PM on 07/10/2025". The date must follow closely.
 */
const midCell = (label: RegExp): RegExp =>
  new RegExp(String.raw`(?:^|[\s|·(])(?:${label.source.slice(1).replace(/\\b$/, "")})\b\s*:?\s*`, "gi");

const dateAfter = (cell: string, from: number, messageDate: number): number | undefined => {
  const found = findDates(cell.slice(from, from + 60), messageDate)[0];
  return found && found.index <= 40 ? found.date : undefined;
};

const firstDate = (text: string, messageDate: number): number | undefined =>
  findDates(text, messageDate)[0]?.date;

/**
 * The date a label introduces: after it in the same cell, in the next
 * cell, in the same column of the next row, or on one of the next lines.
 */
const dateForLabel = (
  lines: readonly Line[],
  i: number,
  cell: number,
  rest: string,
  messageDate: number,
  labels: SpanLabels,
): number | undefined => {
  const line = lines[i]!;
  const inCell = firstDate(rest.slice(0, 60), messageDate);
  if (inCell !== undefined) return inCell;
  const nextCell = line.cells[cell + 1];
  if (nextCell !== undefined && !labels.start.test(nextCell) && !labels.end.test(nextCell)) {
    const d = firstDate(nextCell, messageDate);
    if (d !== undefined) return d;
  }
  const below = lines[i + 1];
  if (line.cells.length > 1 && below && below.cells.length === line.cells.length) {
    const d = firstDate(below.cells[cell]!, messageDate);
    if (d !== undefined) return d;
  }
  for (let j = i + 1; j <= Math.min(lines.length - 1, i + 3); j++) {
    const text = lines[j]!.text;
    if (labels.start.test(text) || labels.end.test(text)) break;
    const d = firstDate(text, messageDate);
    if (d !== undefined) return d;
  }
  return undefined;
};

export interface Span {
  start: number;
  end?: number;
  /** Found under labels (strong) vs. a bare "date – date" range (weak). */
  labeled: boolean;
}

export const findLabeledSpan = (
  lines: readonly Line[],
  messageDate: number,
  labels: SpanLabels,
): Span | null => {
  let start: number | undefined;
  let end: number | undefined;
  const midStart = midCell(labels.start);
  const midEnd = midCell(labels.end);
  lines.forEach((line, i) => {
    line.cells.forEach((cell, c) => {
      if (start === undefined) {
        const m = cell.match(labels.start);
        if (m) start = dateForLabel(lines, i, c, cell.slice(m[0].length), messageDate, labels);
        else for (const mm of cell.matchAll(midStart)) {
          start ??= dateAfter(cell, mm.index + mm[0].length, messageDate);
        }
      }
      if (end === undefined) {
        const m = cell.match(labels.end);
        if (m) end = dateForLabel(lines, i, c, cell.slice(m[0].length), messageDate, labels);
        else for (const mm of cell.matchAll(midEnd)) {
          end ??= dateAfter(cell, mm.index + mm[0].length, messageDate);
        }
      }
    });
  });
  if (start === undefined && end === undefined) return null;
  // Only an end (an extension notice's "Return Time"): that day is the stay.
  if (start === undefined) return { start: end!, labeled: true };
  return { start, end: end !== undefined && end >= start ? end : undefined, labeled: true };
};

/** Text allowed between the two dates of a range. */
const RANGE_GAP_RE = /^\s*(?:-|–|—|→|to|through|until|thru)?\s*$/i;

/** "Sun, Aug 7, 2022 Tue, Aug 9, 2022" / "Aug 10 – Aug 12" on one line. */
export const findRange = (lines: readonly Line[], messageDate: number): Span | null => {
  for (const line of lines) {
    const dates = findDates(line.text, messageDate);
    for (let k = 0; k + 1 < dates.length; k++) {
      const a = dates[k]!;
      const b = dates[k + 1]!;
      const gap = line.text.slice(a.index + a.length, b.index);
      if (b.date > a.date && RANGE_GAP_RE.test(gap)) return { start: a.date, end: b.date, labeled: false };
    }
  }
  return null;
};

const MONTH_DAY_RANGE_RE =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\s*(?:-|–|through|thru|to)\s*(\d{1,2})\b/i;

/** "Aug 10 through 12" — Vrbo subjects. */
const subjectRange = (subject: string, messageDate: number): Span | null => {
  const m = subject.match(MONTH_DAY_RANGE_RE);
  if (!m) return null;
  const start = findDates(`${m[1]} ${m[2]}`, messageDate)[0];
  const end = findDates(`${m[1]} ${m[3]}`, messageDate)[0];
  if (!start || !end || end.date < start.date) return null;
  return { start: start.date, end: end.date, labeled: false };
};

interface StayConfig {
  id: string;
  kind: ReservationKind;
  domains: string[];
  labels: SpanLabels;
  /** Booking-ish subjects; mail without one also needs a confirmation code. */
  subjectRe: RegExp;
  /** The subject alone decides (a sender whose other mail is rides, not rentals). */
  requireSubject?: boolean;
}

const extractStay = (input: ExtractorInput, config: StayConfig, owned: boolean): Extraction | null => {
  const codes = findConfirmationCodes(input.text, input.subject);
  const subjectHit = config.subjectRe.test(input.subject);
  if (!subjectHit && (config.requireSubject || !codes.length)) return null;

  let span = findLabeledSpan(input.lines, input.messageDate, config.labels);
  // Unlabeled ranges are only trusted from the sender's own templates — and
  // complete a labeled start that never states its end ("Aug 7-Aug 9" in a
  // header, "check-in at 3:00 PM on Aug 7" in the fine print).
  if (owned && span?.end === undefined) {
    const range = findRange(input.lines, input.messageDate) ?? subjectRange(input.subject, input.messageDate);
    if (range && (!span || range.start === span.start)) span = range;
  }
  if (!span) return null;
  // Any other sender must show both ends under labels and a code: a lone
  // "arrival" date is as likely a package as a hotel.
  if (!owned && (span.end === undefined || !codes.length)) return null;

  const segment: ReservationSegment = { kind: config.kind, start: span.start };
  if (span.end !== undefined) segment.end = span.end;
  return {
    segments: [segment],
    confirmationCodes: codes,
    cancelled: CANCEL_RE.test(input.subject),
  };
};

const stayExtractor = (config: StayConfig): Extractor => ({
  id: config.id,
  domains: config.domains,
  extract: (input) => extractStay(input, config, true),
});

const LODGING: StayConfig = {
  id: "lodging",
  kind: "lodging",
  domains: [
    "booking.com", "ihg.com", "marriott.com", "hilton.com", "hyatt.com", "accor.com",
    "bestwestern.com", "choicehotels.com", "hotels.com", "vrbo.com", "homeaway.com",
    "airbnb.com", "expedia.com", "riu.com", "apahotel.com", "apa.co.jp", "agoda.com",
    "travellinemail.com", "usedirect.com", "reserveamerica.com", "recreation.gov",
  ],
  labels: LODGING_LABELS,
  subjectRe:
    /\b(booking|reservation|confirm(?:ation|ed)?|your (?:stay|trip|upcoming)|itinerary|receipt|reminder|check[- ]?in|trip)\b/i,
};

const RENTAL: StayConfig = {
  id: "rental",
  kind: "rental",
  domains: [
    "hertz.com", "enterprise.com", "avis.com", "budget.com", "nationalcar.com",
    "alamo.com", "sixt.com", "turo.com", "getaround.com", "zipcar.com", "ufodrive.com",
  ],
  labels: RENTAL_LABELS,
  subjectRe: /\b(booking|reservation|confirm(?:ation|ed)?|rental|trip|receipt|reminder|pick[- ]?up)\b/i,
};

export const lodgingExtractor = stayExtractor(LODGING);
export const rentalExtractor = stayExtractor(RENTAL);
/** Lyft's rental-car arm mails from the same domain as every ride receipt. */
export const lyftRentalExtractor = stayExtractor({
  ...RENTAL,
  id: "lyft-rentals",
  domains: ["lyftmail.com", "lyft.com"],
  subjectRe: /\blyft rentals?\b/i,
  requireSubject: true,
});

/** Any sender: both ends under check-in/out (or pick-up/return) labels plus a code. */
export const genericStayExtractor: Extractor = {
  id: "generic-stay",
  domains: [],
  extract: (input) => extractStay(input, LODGING, false) ?? extractStay(input, RENTAL, false),
};

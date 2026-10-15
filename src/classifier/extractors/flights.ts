/**
 * Text-tier flight parsing. One engine, configured per airline: booking
 * emails differ in layout but all render the same visible atoms — record
 * locator near a label, IATA codes, flight numbers, travel dates.
 *
 * Legs are read from layout lines (see layout.ts), not flattened text: a
 * row naming two airports ("SFO | BOS", "DEPARTS SEA … ARRIVES MDW") is a
 * leg, and so are two lone airport rows stacked one after the other (AA,
 * ZIPAIR, United status mail). Each leg takes the date on its own row, else
 * the nearest day header above it. tidyLegs() then drops what itineraries
 * repeat: seat maps, fare tables, and journey headers over their connections.
 *
 * Tuned against real mail with `pnpm eval` (src/eval/reservations.eval.ts).
 */
import { AIRLINE_CODES, AIRPORT_CITIES, isKnownAirport } from "../../shared/airports";
import type { ReservationSegment } from "../../shared/types";
import type { Line } from "./layout";
import type { Extraction, Extractor, ExtractorInput } from "./types";
import {
  CANCEL_RE,
  NON_TRAVEL_DATE_RE,
  findConfirmationCodes,
  findDates,
  findSubjectDates,
} from "./text";

export interface AirlineConfig {
  id: string;
  domains: string[];
  /** Flight-number prefixes to trust (["UA"]); empty = any known airline code. */
  airlineCodes: string[];
  /** Subjects that mark a booking email (itineraries, receipts, schedule changes). */
  subjectRe: RegExp;
}

interface Located {
  value: string;
  index: number;
}

const FLIGHT_TOKEN_RE = /\b([A-Z]{2})\s?-?\s?(\d{1,4})\b/g;


export const findFlights = (text: string, prefixes: readonly string[]): Located[] => {
  const allowed = prefixes.length ? new Set(prefixes) : AIRLINE_CODES;
  const out: Located[] = [];
  for (const match of text.matchAll(FLIGHT_TOKEN_RE)) {
    const carrier = match[1];
    if (carrier === undefined || !allowed.has(carrier)) continue;
    out.push({ value: `${carrier} ${match[2]}`, index: match.index });
  }
  return out;
};


// ─── layout-line leg finding ────────────────────────────────────────────────

/** Codes that are also everyday shouting ("TSA PreCheck", "ADD BAGS"). */
const AMBIGUOUS_AIRPORTS = new Set(["TSA", "ADD"]);

const CONNECTOR = String.raw`\s*(?:-+|–|—|[→➔➝⟶>]|\bto\b|\|)\s*`;
const PAIR_BEFORE_RE = new RegExp(String.raw`[A-Z]{3}${CONNECTOR}$`);
/** "Depart: Charlotte, NC - CLT" — the code after a "City, ST" label. */
const CITY_DASH_BEFORE_RE = /,\s*[A-Z]{2}\s*[-–]\s*$/;
const PAIR_AFTER_RE = new RegExp(String.raw`^${CONNECTOR}[A-Z]{3}(?![A-Za-z0-9])`);
const LABEL_BEFORE_RE =
  /(?:depart(?:s|ing|ure)?|arriv(?:es|ing|al)|from|to|dep|arr|origin|destination)\s*:?\s*$/i;
/** "San Francisco 12:15 PM SFO Wed, Dec 28" (Chase Travel). */
const TIME_BEFORE_RE = /\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?\s*$/i;
/** "SFO San Francisco", "SFO 6:30 AM", "SFO" — not "SAN DIEGO", "PER PERSON". */
const CELL_START_RE = /^\s*(?:$|[A-Z][a-z]|\d|\(|\|)/;
const TIME_RE = /\b\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?/i;

/** A city printed instead of a code ("Seattle, WA | 4:13 PM"), when unique. */
const CITY_AIRPORT: Map<string, string> = (() => {
  const byCity = new Map<string, string[]>();
  for (const [code, city] of Object.entries(AIRPORT_CITIES)) {
    const key = city.toLowerCase();
    byCity.set(key, [...(byCity.get(key) ?? []), code]);
  }
  const out = new Map<string, string>();
  for (const [city, codes] of byCity) if (codes.length === 1) out.set(city, codes[0]!);
  return out;
})();
const CITY_CELL_RE = /^([A-Z][A-Za-z .'-]+?),\s*[A-Z]{2}$/;

/**
 * The airports a line names, in order. A 3-letter capital token only counts
 * where layouts actually put airport codes: a cell of its own, in parens,
 * beside a route connector ("SFO - BOS", "SEA | BOS"), after a departs/
 * arrives label, or leading a cell. That keeps shouty prose ("SAN DIEGO,
 * CA", "PER PERSON") from becoming legs.
 */
export interface LineAirport {
  code: string;
  /** Labeled or leading its cell — a row about this airport, even if long. */
  anchored: boolean;
}

export const airportsInLine = (line: Line): LineAirport[] => {
  const out: LineAirport[] = [];
  const push = (code: string, anchored = true): void => {
    if (out.at(-1)?.code !== code) out.push({ code, anchored });
  };
  for (const cell of line.cells) {
    const city = cell.match(CITY_CELL_RE)?.[1]?.toLowerCase();
    if (city && CITY_AIRPORT.has(city) && line.cells.length > 1 && TIME_RE.test(line.text)) {
      push(CITY_AIRPORT.get(city)!);
      continue;
    }
    for (const match of cell.matchAll(/(?<![A-Za-z0-9])([A-Z]{3})(?![A-Za-z0-9])/g)) {
      const code = match[1]!;
      if (!isKnownAirport(code)) continue;
      const before = cell.slice(0, match.index);
      const after = cell.slice(match.index + 3);
      const paired =
        PAIR_BEFORE_RE.test(before) || PAIR_AFTER_RE.test(after) || CITY_DASH_BEFORE_RE.test(before);
      const parens = before.endsWith("(") && after.startsWith(")");
      const labeled = LABEL_BEFORE_RE.test(before) || TIME_BEFORE_RE.test(before);
      const leads = !before.trim() && CELL_START_RE.test(after);
      const leading = leads && !AMBIGUOUS_AIRPORTS.has(code);
      // Parens alone is weak in prose: "New York (LGA), Newark, Orange
      // County (SNA), Orlando…" lists served cities, not a route.
      const parensOk = parens && cell.length <= 120;
      if (paired || parensOk || labeled || leading) push(code, labeled || leading);
    }
  }
  return out;
};

export interface FoundLeg {
  origin: string;
  destination: string;
  date: number;
  /** The line the leg was read from; for ordering and nearby lookups. */
  line: number;
  /** Read from one row ("SFO | BOS") vs. stacked rows (AA, ZIPAIR, United). */
  form: "row" | "stacked";
  flight?: string;
  /** The date line's second date, when it reads as a range ("Aug 7 - Aug 10"). */
  rangeEnd?: number;
  /**
   * Lines between the leg and the date it took (0 = its own row; stamps and
   * subjects rank far behind). When a route repeats, the closest wins.
   */
  distance: number;
}

interface LineDates {
  /** Every date on the line; a leg row's own dates are trusted regardless. */
  all: number[];
  /** Dates when the line isn't about purchase/arrival/etc., else none. */
  dates: number[];
  travel: boolean;
  /** One cell reading "August 07 - August 10", not "dep date | arr date". */
  range: boolean;
  /** Possibly the email's send-date stamp; see findLegs. */
  stamp: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The leg's date: on its own line, else the nearest travel-date line above
 * (itineraries put "Monday, December 19" over the leg rows, and one header
 * covers every connection that day), else just below.
 */
const legDate = (
  info: readonly LineDates[],
  at: number,
  subjectDates: readonly number[],
): { date: number; distance: number; rangeEnd?: number } | null => {
  const own = info[at];
  if (own?.all.length) return { date: own.all[0]!, distance: 0 };
  for (let i = at - 1; i >= Math.max(0, at - 25); i--) {
    const d = info[i];
    if (d?.travel && d.dates.length) {
      const [first, second] = d.dates;
      return {
        date: first!,
        // A possible send-date stamp only wins when nothing better dates the route.
        distance: at - i + (d.stamp ? STAMP_PENALTY : 0),
        rangeEnd: d.range && second! > first! ? second : undefined,
      };
    }
  }
  for (let i = at + 1; i <= Math.min(info.length - 1, at + 8); i++) {
    const d = info[i];
    if (d?.travel && d.dates.length) return { date: d.dates[0]!, distance: i - at };
  }
  // Southwest standby/upsell mail: "Your 03/17 Las Vegas trip", body undated.
  return subjectDates.length ? { date: subjectDates[0]!, distance: SUBJECT_DISTANCE } : null;
};

const STAMP_PENALTY = 50;
const SUBJECT_DISTANCE = 100;

export const findLegs = (
  lines: readonly Line[],
  messageDate: number,
  airlineCodes: readonly string[],
  subject = "",
): FoundLeg[] => {
  const subjectDates = findSubjectDates(subject, messageDate);
  const info: LineDates[] = lines.map((l, i) => {
    const travel = !NON_TRAVEL_DATE_RE.test(l.text);
    const found = findDates(l.text, messageDate);
    const all = found.map((f) => f.date);
    const range = all.length === 2 && l.cells.length === 1 && /\d\s*[-–—]\s*[A-Za-z]/.test(l.text);
    // A bare date near the top may be the email's own stamp ("Wednesday,
    // October 19, 2022"), or the itinerary's day header — the same text.
    // Which one only shows later, when the route repeats with another date.
    const stamp =
      i < 10 && found.length === 1 && l.text.length <= 32 && Math.abs(all[0]! - messageDate) < 2 * DAY_MS;
    return { travel, all, dates: travel ? all : [], range, stamp };
  });
  const flightOn = (i: number): string | undefined => {
    for (let j = i; j >= Math.max(0, i - 6); j--) {
      const f = findFlights(lines[j]!.text, airlineCodes)[0];
      if (f) return f.value;
    }
    return undefined;
  };

  const legs: FoundLeg[] = [];
  const add = (origin: string, destination: string, line: number, form: FoundLeg["form"]): void => {
    if (origin === destination) return;
    const when = legDate(info, line, subjectDates);
    if (!when) return;
    legs.push({ origin, destination, line, form, flight: flightOn(line), ...when });
  };

  let pending: { code: string; line: number } | null = null;
  lines.forEach((line, i) => {
    const airports = airportsInLine(line);
    if (airports.length >= 2) {
      pending = null;
      for (let k = 0; k + 1 < airports.length; k += 2) {
        add(airports[k]!.code, airports[k + 1]!.code, i, "row");
      }
      return;
    }
    // A lone code only stacks with its partner on a label-sized line or an
    // anchored row ("Departing SEA Seattle, WA 7/14/22 4:13 PM") — not
    // "Flight UA876 to San Francisco (SFO) is delayed".
    const lone = airports[0];
    if (lone && (line.text.length <= 40 || lone.anchored)) {
      const code = lone.code;
      if (pending && i - pending.line <= 14 && pending.code !== code) {
        add(pending.code, code, pending.line, "stacked");
        pending = null;
      } else {
        pending = { code, line: i };
      }
    }
  });
  return legs;
};

/**
 * Collapse what itineraries repeat: the same leg in a seat map or summary
 * row, and journey headers ("BOS | SFO") whose connections are listed below.
 */
export const tidyLegs = (legs: readonly FoundLeg[]): FoundLeg[] => {
  const seen = new Set<string>();
  // A route printed again further from its date — a seat map's "SFO-ORD
  // 14F" under the last leg, a summary under the send-date stamp — took a
  // neighbor's date. Keep each route's best-dated copies only.
  const best = new Map<string, number>();
  for (const l of legs) {
    const route = `${l.origin}>${l.destination}`;
    best.set(route, Math.min(best.get(route) ?? Infinity, l.distance));
  }
  const dated = legs.filter((l) => l.distance === best.get(`${l.origin}>${l.destination}`));
  const unique = dated.filter((l) => {
    const key = `${l.origin}>${l.destination}@${dayKey(l.date)}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
  // A leg is a journey summary when the other legs chain from its origin
  // to its destination on its date: BOS→DEN→SFO covers "BOS | SFO".
  const chains = (journey: FoundLeg): boolean => {
    const others = unique.filter((l) => l !== journey && dayKey(l.date) === dayKey(journey.date));
    const reach = (from: string, hops: number): boolean =>
      hops < 4 &&
      others.some((l) => l.origin === from && (l.destination === journey.destination || reach(l.destination, hops + 1)));
    return others.some(
      (l) => l.origin === journey.origin && l.destination !== journey.destination && reach(l.destination, 1),
    );
  };
  const kept = unique.filter((l) => !chains(l));
  // Summary-only mail ("August 07 - August 10 / HNL | OGG"): the range's
  // far end is the return, which the email never spells out.
  const only = kept.length === 1 ? kept[0] : undefined;
  if (only?.rangeEnd !== undefined) {
    kept.push({ ...only, origin: only.destination, destination: only.origin, date: only.rangeEnd, rangeEnd: undefined, flight: undefined });
  }
  return kept;
};

const dayKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const DEPARTS_LABEL_RE = /\bdepart(?:s|ure|ing)?(?:\s+date)?\s*:\s*/gi;

/** A date printed right after a "Departs:" label, if any. */
const departureDate = (input: ExtractorInput): number | undefined => {
  for (const line of input.lines) {
    for (const match of line.text.matchAll(DEPARTS_LABEL_RE)) {
      const after = line.text.slice(match.index + match[0].length, match.index + match[0].length + 40);
      const found = findDates(after, input.messageDate)[0];
      if (found && found.index === 0) return found.date;
    }
  }
  return undefined;
};

export const extractFlightText = (
  input: ExtractorInput,
  config: Pick<AirlineConfig, "airlineCodes" | "subjectRe">,
): Extraction | null => {
  const codes = findConfirmationCodes(input.text, input.subject);
  const subjectHit = config.subjectRe.test(input.subject);
  // A booking email announces itself in the subject or carries a locator;
  // anything else from the airline (promos, surveys) is not a reservation.
  if (!subjectHit && !codes.length) return null;
  // Subject alone isn't proof for the generic tier (any airline-ish sender):
  // demand a locator too, or the parse gets promos with a date and a route.
  if (!config.airlineCodes.length && !codes.length) return null;

  const legs = tidyLegs(findLegs(input.lines, input.messageDate, config.airlineCodes, input.subject));
  if (!legs.length) {
    // Reminders that name only a city ("Destination: New York/Newark …
    // Departs: December 21, 2022") still pin the trip's date.
    const departs = departureDate(input);
    if (departs === undefined) return null;
    return {
      segments: [{ kind: "flight", start: departs }],
      confirmationCodes: codes,
      cancelled: CANCEL_RE.test(input.subject),
    };
  }
  const segments: ReservationSegment[] = legs.map((l) => ({
    kind: "flight",
    start: l.date,
    origin: l.origin,
    destination: l.destination,
    summary: [l.flight, `${l.origin} → ${l.destination}`].filter(Boolean).join(" "),
  }));
  return {
    segments,
    confirmationCodes: codes,
    cancelled: CANCEL_RE.test(input.subject),
  };
};

const airlineExtractor = (config: AirlineConfig): Extractor => ({
  id: config.id,
  domains: config.domains,
  extract: (input) => extractFlightText(input, config),
});

const BOOKING_SUBJECT_RE =
  /\b(itinerary|e-?ticket|confirmation|receipt|schedule change|flight change|boarding|check[- ]?in|your (?:[\w-]+ ){0,3}(?:trip|flight)|delayed|cancell?ed)\b/i;

export const unitedExtractor = airlineExtractor({
  id: "united",
  domains: ["united.com"],
  airlineCodes: ["UA"],
  subjectRe: BOOKING_SUBJECT_RE,
});

export const americanExtractor = airlineExtractor({
  id: "american",
  domains: ["aa.com"],
  airlineCodes: ["AA"],
  subjectRe: BOOKING_SUBJECT_RE,
});

export const zipairExtractor = airlineExtractor({
  id: "zipair",
  domains: ["zipair.net", "zipairtokyo.com"],
  airlineCodes: ["ZG"],
  subjectRe: /\b(reservation|booking|itinerary|confirmation|e-?ticket|payment)\b/i,
});

export const jalExtractor = airlineExtractor({
  id: "jal",
  domains: ["jal.co.jp", "jal.com", "jalmail.jal.co.jp"],
  airlineCodes: ["JL"],
  subjectRe: /\b(reservation|itinerary|confirmation|e-?ticket|receipt|purchase)\b/i,
});

/** Any other sender that looks airline-ish; held to stricter evidence. */
export const genericFlightExtractor: Extractor = {
  id: "generic-flight",
  domains: [],
  extract: (input) =>
    extractFlightText(input, {
      airlineCodes: [],
      subjectRe: BOOKING_SUBJECT_RE,
    }),
};

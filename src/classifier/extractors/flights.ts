/**
 * Text-tier flight parsing. One engine, configured per airline: booking
 * emails differ in layout but all render the same visible atoms — record
 * locator near a label, IATA codes, flight numbers, travel dates. The engine
 * collects those atoms with positions and pairs them up; per-airline configs
 * mostly just pin down which sender domains and flight-number prefixes count.
 *
 * Iterated against real mail via neoTripExtract() — expect these to be tuned.
 */
import { AIRLINE_CODES, isKnownAirport } from "../../shared/airports";
import type { ReservationSegment } from "../../shared/types";
import type { Extraction, Extractor, ExtractorInput } from "./types";
import { CANCEL_RE, dateNear, findConfirmationCodes, findDates } from "./text";

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

const AIRPORT_TOKEN_RE = /(?:^|[^A-Z0-9])([A-Z]{3})(?![A-Z0-9])/g;
const FLIGHT_TOKEN_RE = /\b([A-Z]{2})\s?-?\s?(\d{1,4})\b/g;

export const findAirports = (text: string): Located[] => {
  const out: Located[] = [];
  for (const match of text.matchAll(AIRPORT_TOKEN_RE)) {
    const code = match[1];
    if (code === undefined || !isKnownAirport(code)) continue;
    // Consecutive duplicates are layout noise (code repeated in a header row).
    if (out.at(-1)?.value === code && match.index - (out.at(-1)?.index ?? 0) < 40) continue;
    out.push({ value: code, index: match.index });
  }
  return out;
};

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

const flightNear = (flights: readonly Located[], index: number): string | undefined => {
  let best: Located | undefined;
  for (const f of flights) {
    if (f.index > index) break;
    best = f;
  }
  return (best ?? flights[0])?.value;
};

export const extractFlightText = (
  input: ExtractorInput,
  config: Pick<AirlineConfig, "airlineCodes" | "subjectRe">,
): Extraction | null => {
  const codes = findConfirmationCodes(input.text);
  const subjectHit = config.subjectRe.test(input.subject);
  // A booking email announces itself in the subject or carries a locator;
  // anything else from the airline (promos, surveys) is not a reservation.
  if (!subjectHit && !codes.length) return null;

  const dates = findDates(input.text, input.messageDate);
  const airports = findAirports(input.text);
  const flights = findFlights(input.text, config.airlineCodes);
  if (!dates.length) return null;
  if (airports.length < 2 && !flights.length) return null;
  // Subject alone isn't proof for the generic tier (any airline-ish sender):
  // demand a locator too, or the parse gets promos with a date and a route.
  if (!config.airlineCodes.length && !codes.length) return null;

  const segments: ReservationSegment[] = [];
  // Itineraries render each leg as "origin … destination"; adjacent distinct
  // codes pair up in order (SFO NRT / NRT SFO for a round trip).
  for (let i = 0; i + 1 < airports.length; i += 2) {
    const origin = airports[i];
    const destination = airports[i + 1];
    if (!origin || !destination || origin.value === destination.value) {
      i -= 1; // realign on repeated codes so the next pair starts here
      continue;
    }
    const near = dateNear(dates, origin.index);
    if (!near) continue;
    const flight = flightNear(flights, origin.index);
    segments.push({
      kind: "flight",
      start: near.date,
      origin: origin.value,
      destination: destination.value,
      summary: [flight, `${origin.value} → ${destination.value}`]
        .filter(Boolean)
        .join(" "),
    });
  }

  // No pairable airports (codes we don't know, or layout we mis-read): fall
  // back to a single-day segment anchored to whichever evidence we actually
  // found (a flight number, else the lone airport code) — NOT to "some date
  // in the document." An unanchored pick (e.g. the widest span across every
  // date in the body, or just the first date) grabs whatever footer/promo
  // date happens to be nearby, and status/loyalty emails that only barely
  // qualify (a confirmation code plus one flight-number-shaped token) then
  // get essentially arbitrary dates. Against Dan's real mailbox this chained
  // dozens of unrelated United emails into one 240-member, 7-year "trip":
  // each pulled a plausible-looking but unrelated date, and enough of them
  // landed within days of each other to bridge real trips together.
  if (!segments.length) {
    const anchor = flights[0]?.index ?? airports[0]?.index;
    const near = anchor === undefined ? undefined : dateNear(dates, anchor);
    if (!near) return null;
    segments.push({
      kind: "flight",
      start: near.date,
      summary: flights[0]?.value,
    });
  }

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
  /\b(itinerary|e-?ticket|confirmation|receipt|schedule change|flight change|boarding|check[- ]?in|your (?:trip|flight|upcoming))\b/i;

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

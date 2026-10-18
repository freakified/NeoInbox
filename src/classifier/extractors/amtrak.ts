/**
 * Amtrak eTickets and receipts. Every train is printed as one run:
 *   TRAIN 541: Sacramento, CA - Sacramento Valley Station to Omaha, NE
 *   (One-Way) Depart 11:55 AM, Thursday, April 21, 2022
 * Station names are free text with dashes and "to" inside them, so the
 * route only splits when both ends read as "City, ST": then origin and
 * destination take the cities and the summary is just the train; otherwise
 * the summary keeps the route verbatim.
 * The eTicket-only template carries nothing but a PDF; its subject still
 * names the travel date ("eTicket for Your 04/21/2022 Trip").
 */
import type { ReservationSegment } from "../../shared/types";
import type { Extraction, Extractor } from "./types";
import { CANCEL_RE, findConfirmationCodes, findDates } from "./text";

const TRAIN_RUN_RE =
  /\bTRAIN\s*(\d{1,4})\s*:\s*(.{3,160}?)\s*Depart\s+\d{1,2}:\d{2}\s*[AP]M,?\s*((?:[A-Za-z]+,?\s+)?[A-Za-z]+\.?\s+\d{1,2},?\s+\d{4})/gi;
const SUBJECT_TRIP_DATE_RE = /\bfor your (\d{1,2}\/\d{1,2}\/\d{4}) trip\b/i;
/** "Sacramento, CA - Sacramento Valley Station" → Sacramento. */
const cityOf = (station: string | undefined): string | undefined =>
  station?.match(/^\s*([A-Z][A-Za-z .'-]*?)\s*,\s*[A-Z]{2}\b/)?.[1];

const SUBJECT_RE = /\b(reservation|e-?ticket|confirmation|receipt|trip|travel)\b/i;

export const amtrakExtractor: Extractor = {
  id: "amtrak",
  domains: ["amtrak.com"],
  extract: (input): Extraction | null => {
    const codes = findConfirmationCodes(input.text, input.subject);
    if (!SUBJECT_RE.test(input.subject) && !codes.length) return null;

    const segments: ReservationSegment[] = [];
    const seen = new Set<string>();
    for (const match of input.text.matchAll(TRAIN_RUN_RE)) {
      const date = findDates(match[3] ?? "", input.messageDate)[0]?.date;
      if (date === undefined) continue;
      const key = `${match[1]}@${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const route = (match[2] ?? "").replace(/\s*\((?:one-way|round-trip)\)\s*$/i, "");
      const ends = route.split(/\s+to\s+/i);
      const segment: ReservationSegment = { kind: "train", start: date, summary: `Train ${match[1]} ${route}` };
      const origin = ends.length > 1 ? cityOf(ends[0]) : undefined;
      const destination = ends.length > 1 ? cityOf(ends[ends.length - 1]) : undefined;
      if (origin && destination) {
        // The itinerary prints "Omaha to Chicago – Train 6" from these.
        segment.origin = origin;
        segment.destination = destination;
        segment.summary = `Train ${match[1]}`;
      }
      segments.push(segment);
    }
    if (!segments.length) {
      const subjectDate = input.subject.match(SUBJECT_TRIP_DATE_RE)?.[1];
      const date = subjectDate ? findDates(subjectDate, input.messageDate)[0]?.date : undefined;
      if (date === undefined) return null;
      segments.push({ kind: "train", start: date, summary: "Amtrak" });
    }

    return {
      segments,
      confirmationCodes: codes,
      cancelled: CANCEL_RE.test(input.subject),
    };
  },
};

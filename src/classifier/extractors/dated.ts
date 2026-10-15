/**
 * One-date reservations: restaurant tables and event tickets. There's no
 * route or span to read, just the day — printed beside "Table for 5 on …" /
 * "Party of 4", or as the event's own date line, and usually in the subject
 * too ("… on Thursday, December 9, 2021, 7:30 PM").
 */
import type { ReservationKind } from "../../shared/types";
import type { Extraction, Extractor, ExtractorInput } from "./types";
import { CANCEL_RE, NON_TRAVEL_DATE_RE, findConfirmationCodes, findDates } from "./text";

interface DatedConfig {
  id: string;
  kind: ReservationKind;
  domains: string[];
  subjectRe: RegExp;
  /** Lines that state the booked date; absent = the first travel-date line. */
  lineRe?: RegExp;
}

const extractDated = (input: ExtractorInput, config: DatedConfig): Extraction | null => {
  const codes = findConfirmationCodes(input.text, input.subject);
  if (!config.subjectRe.test(input.subject) && !codes.length) return null;

  let date: number | undefined;
  for (const line of input.lines) {
    if (NON_TRAVEL_DATE_RE.test(line.text)) continue;
    if (config.lineRe && !config.lineRe.test(line.text)) continue;
    date = findDates(line.text, input.messageDate)[0]?.date;
    if (date !== undefined) break;
  }
  date ??= findDates(input.subject, input.messageDate)[0]?.date;
  if (date === undefined) return null;
  return {
    segments: [{ kind: config.kind, start: date }],
    confirmationCodes: codes,
    cancelled: CANCEL_RE.test(input.subject),
  };
};

const datedExtractor = (config: DatedConfig): Extractor => ({
  id: config.id,
  domains: config.domains,
  extract: (input) => extractDated(input, config),
});

export const diningExtractor = datedExtractor({
  id: "dining",
  kind: "dining",
  domains: ["opentable.com", "exploretock.com", "resy.com", "sevenrooms.com"],
  subjectRe: /\b(reservation|booking|confirm(?:ed|ation)?|reminder)\b/i,
  lineRe: /\b(table for|party of|guests?|people|reservation)\b/i,
});

export const eventExtractor = datedExtractor({
  id: "event",
  kind: "event",
  domains: ["eventbrite.com", "feverup.com", "ticketmaster.com", "axs.com", "seetickets.us"],
  subjectRe: /\b(tickets?|order|confirm(?:ed|ation)?|registration|reservation)\b/i,
});

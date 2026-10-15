/**
 * Amtrak eTickets and receipts. Every train is printed as one run:
 *   TRAIN 541: Sacramento, CA - Sacramento Valley Station to Omaha, NE
 *   (One-Way) Depart 11:55 AM, Thursday, April 21, 2022
 * Station names are free text with dashes and "to" inside them, so they go
 * into the summary verbatim instead of being split into origin/destination.
 * The eTicket-only template carries nothing but a PDF; its subject still
 * names the travel date ("eTicket for Your 04/21/2022 Trip").
 */
import type { ReservationSegment } from "../../shared/types";
import type { Extraction, Extractor } from "./types";
import { CANCEL_RE, findConfirmationCodes, findDates } from "./text";

const TRAIN_RUN_RE =
  /\bTRAIN\s*(\d{1,4})\s*:\s*(.{3,160}?)\s*Depart\s+\d{1,2}:\d{2}\s*[AP]M,?\s*((?:[A-Za-z]+,?\s+)?[A-Za-z]+\.?\s+\d{1,2},?\s+\d{4})/gi;
const SUBJECT_TRIP_DATE_RE = /\bfor your (\d{1,2}\/\d{1,2}\/\d{4}) trip\b/i;
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
      segments.push({ kind: "train", start: date, summary: `Train ${match[1]} ${route}` });
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

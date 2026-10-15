/**
 * A real message captured for detector evaluation: exactly what the
 * extractors get to see (decoded text and HTML parts plus headers), and
 * nothing Thunderbird-specific. `neoSampleDump()` in the background console
 * writes these to fixtures/real-mail/ (gitignored — it's your actual mail),
 * and the *.eval.ts suites (`pnpm eval`) score detectors against them.
 *
 * Each sample can have a sibling `<name>.expect.json` (an ExpectFile) holding
 * the hand-checked answer per detector. Detectors other than reservations
 * (packages, purchases, events, …) add their own key to ExpectFile and reuse
 * the same samples, dump tooling and report plumbing.
 */
import { htmlToLines, linesToText, type Line } from "./extractors/layout";
import { htmlToText } from "./extractors/text";
import type { ExtractorInput } from "./extractors/types";
import { parseSender } from "../shared/senders";
import type { ReservationKind } from "../shared/types";

export interface MailSample {
  /** pinKeyOf the message (its Message-ID) — stable across folder moves. */
  key: string;
  /** Which sample set selected it ("trips"); also its top-level folder. */
  set: string;
  author: string;
  senderDomain: string;
  subject: string;
  /** Date header (ms). */
  date: number;
  headers: Record<string, string[]>;
  textParts: string[];
  htmlParts: string[];
}

/** One expected reservation segment, written by hand, dates as YYYY-MM-DD. */
export interface ExpectedSegment {
  kind: ReservationKind;
  start: string;
  end?: string;
  origin?: string;
  destination?: string;
}

/**
 * What a message should yield. `segments: []` means "not a reservation" —
 * the codes still matter there, since that's how check-in reminders and
 * receipts attach to the trip owning the code.
 *
 * Labeling conventions (keep labels consistent, or the scores mean nothing):
 * - Segments come from anything that restates the booking's dates:
 *   confirmations, changes, reminders, receipts, check-in notices, property
 *   messages quoting the stay. Not from post-trip reviews/surveys, holds that
 *   weren't booked, marketing, or other people's itineraries.
 * - Flights: one segment per leg, departure date, IATA origin/destination.
 *   When only the journey is shown (upsell mail), one BOS→SFO segment.
 * - Lodging/rentals: start = check-in/pickup, end = check-out/drop-off.
 *   Trains/buses: departure date only (station names are free text).
 *   Dining/events: the date only.
 * - Codes: the booking's real confirmation numbers (5+ alphanumerics) as
 *   printed anywhere in the message, subject included; never loyalty,
 *   order, ticket-document or account numbers.
 * - A cancellation keeps the cancelled segments and sets `cancelled`.
 *
 * Shorthand tooling: scripts/labels/view.py prints samples compactly and
 * scripts/labels/apply.py writes labels from "name | segs | codes | flags".
 */
export interface ExpectedReservation {
  /** Drafts (`EVAL_DRAFT=1 pnpm eval`) start false and are left out of scoring. */
  reviewed: boolean;
  segments: ExpectedSegment[];
  codes: string[];
  cancelled?: boolean;
}

/** Labels per detector; each carries its own `reviewed` flag. */
export interface ExpectFile {
  notes?: string;
  reservation?: ExpectedReservation;
}

/** The extractor input for a message, built the same way the sweep builds it. */
export const buildExtractorInput = (m: {
  author: string;
  subject: string;
  date: number;
  textParts: readonly string[];
  htmlParts: readonly string[];
}): ExtractorInput => {
  const html = m.htmlParts.join("\n");
  const sender = parseSender(m.author);
  const htmlLines = htmlToLines(html);
  // No DOMParser (shouldn't happen in TB or tests): the regex flattener.
  const htmlText = htmlLines.length || !html ? linesToText(htmlLines) : htmlToText(html);
  const plain = m.textParts.join("\n");
  // Text parts are often a stub ("view this email in a browser") or a lossy
  // rendering; the HTML's rows carry the structure, so prefer them unless
  // the plain part is clearly the fuller copy.
  const lines: Line[] =
    htmlText.length >= plain.length * 0.5 && htmlLines.length
      ? htmlLines
      : plain
          .split(/\r?\n/)
          .map((t) => t.replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .map((text) => ({ text, cells: [text], table: 0 }));
  return {
    senderEmail: sender.email,
    senderDomain: sender.domain,
    subject: m.subject,
    messageDate: m.date,
    text: [plain, htmlText].join("\n"),
    lines,
    html,
  };
};

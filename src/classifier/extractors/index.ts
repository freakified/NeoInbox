/**
 * Reservation extractor registry. Tiers, most precise first:
 *   1. schema.org JSON-LD, when the sender still embeds it (Airbnb, Spirit,
 *      OpenTable, FareHarbor) — exact fields, no guessing.
 *   2. The per-sender text parser owning the sender's domain.
 *   3. Strict generic parsers for everyone else: flights (locator + legs),
 *      then stays/rentals (labeled start and end dates + a code).
 *
 * The winner's confirmation codes are unioned with contextual codes found in
 * the visible text: PNR matching (phase 3) wants every code the email shows,
 * and JSON-LD blocks frequently omit the locator printed in the body.
 */
import { domainMatches } from "../../shared/routeRules";
import { amtrakExtractor } from "./amtrak";
import { diningExtractor, eventExtractor } from "./dated";
import {
  americanExtractor,
  genericFlightExtractor,
  jalExtractor,
  unitedExtractor,
  zipairExtractor,
} from "./flights";
import { jsonLdExtractor } from "./jsonld";
import { smartexExtractor } from "./smartex";
import {
  genericStayExtractor,
  lodgingExtractor,
  lyftRentalExtractor,
  rentalExtractor,
} from "./stays";
import { findConfirmationCodes } from "./text";
import type { Extraction, Extractor, ExtractorInput } from "./types";

export type { Extraction, ExtractorInput } from "./types";

/** Bump to invalidate every stored ReservationRecord and re-extract. */
export const EXTRACTOR_VERSION = 1;

const DOMAIN_EXTRACTORS: Extractor[] = [
  unitedExtractor,
  americanExtractor,
  zipairExtractor,
  jalExtractor,
  amtrakExtractor,
  lodgingExtractor,
  rentalExtractor,
  lyftRentalExtractor,
  smartexExtractor,
  diningExtractor,
  eventExtractor,
];

export const extractorForDomain = (domain: string): Extractor | undefined =>
  DOMAIN_EXTRACTORS.find((e) => domainMatches(domain, e.domains));

/** Domains with a dedicated parser always count as extraction candidates. */
export const hasSenderExtractor = (domain: string): boolean =>
  extractorForDomain(domain) !== undefined;

export interface ExtractionResult extends Extraction {
  extractor: string;
}

/**
 * Mail that restates an itinerary without being a booking: unpaid holds,
 * unanswered booking requests, post-trip surveys, review requests. Their codes still count (the sweep
 * records them), but they must never put a trip on the calendar.
 */
const NOT_A_BOOKING_SUBJECT_RE =
  /\b(on hold|survey|how was your|how did we do|rate your|review your (?:stay|trip|flight)|tell us about your|leave a review|feedback|booking request|request sent|reminder to book|requested to book)\b/i;

const FORWARD_SUBJECT_RE = /^\s*(?:fwd?|fw)\s*:/i;
const FORWARDED_FROM_RE = /^from:.*?[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/i;

/**
 * "Fwd: Amtrak: eTicket …" from a family member's gmail: the original
 * sender, from the forwarded header block, picks the parser.
 */
const forwardedDomain = (input: ExtractorInput): string | undefined => {
  if (!FORWARD_SUBJECT_RE.test(input.subject)) return undefined;
  for (const line of input.lines.slice(0, 40)) {
    const domain = line.text.match(FORWARDED_FROM_RE)?.[1];
    if (domain) return domain.toLowerCase();
  }
  return undefined;
};

export const runExtractors = (input: ExtractorInput): ExtractionResult | null => {
  if (NOT_A_BOOKING_SUBJECT_RE.test(input.subject)) return null;
  const chain: Extractor[] = [jsonLdExtractor];
  const forwarded = forwardedDomain(input);
  if (forwarded) {
    input = { ...input, senderDomain: forwarded, subject: input.subject.replace(FORWARD_SUBJECT_RE, "").trim() };
  }
  const owned = extractorForDomain(input.senderDomain);
  if (owned) chain.push(owned);
  else chain.push(genericFlightExtractor, genericStayExtractor);

  for (const extractor of chain) {
    const hit = extractor.extract(input);
    if (!hit) continue;
    const codes = new Set(hit.confirmationCodes);
    for (const code of findConfirmationCodes(input.text, input.subject)) codes.add(code);
    return { ...hit, confirmationCodes: [...codes], extractor: extractor.id };
  }
  return null;
};

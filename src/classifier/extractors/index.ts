/**
 * Reservation extractor registry. Tiers, most precise first:
 *   1. schema.org JSON-LD, when the sender still embeds it (Airbnb, Spirit,
 *      OpenTable, FareHarbor) — exact fields, no guessing.
 *   2. The per-sender text parser owning the sender's domain.
 *   3. A strict generic flight parser for airlines with no dedicated config.
 *
 * The winner's confirmation codes are unioned with contextual codes found in
 * the visible text: PNR matching (phase 3) wants every code the email shows,
 * and JSON-LD blocks frequently omit the locator printed in the body.
 */
import { domainMatches } from "../../shared/routeRules";
import { amtrakExtractor } from "./amtrak";
import {
  americanExtractor,
  genericFlightExtractor,
  jalExtractor,
  unitedExtractor,
  zipairExtractor,
} from "./flights";
import { jsonLdExtractor } from "./jsonld";
import { lodgingExtractor } from "./lodging";
import { smartexExtractor } from "./smartex";
import { findConfirmationCodes } from "./text";
import type { Extraction, Extractor, ExtractorInput } from "./types";

export type { Extraction, ExtractorInput } from "./types";

/** Bump to invalidate every stored ReservationRecord and re-extract. */
export const EXTRACTOR_VERSION = 4;

const DOMAIN_EXTRACTORS: Extractor[] = [
  unitedExtractor,
  americanExtractor,
  zipairExtractor,
  jalExtractor,
  amtrakExtractor,
  lodgingExtractor,
  smartexExtractor,
];

export const extractorForDomain = (domain: string): Extractor | undefined =>
  DOMAIN_EXTRACTORS.find((e) => domainMatches(domain, e.domains));

/** Domains with a dedicated parser always count as extraction candidates. */
export const hasSenderExtractor = (domain: string): boolean =>
  extractorForDomain(domain) !== undefined;

export interface ExtractionResult extends Extraction {
  extractor: string;
}

export const runExtractors = (input: ExtractorInput): ExtractionResult | null => {
  const chain: Extractor[] = [jsonLdExtractor];
  const owned = extractorForDomain(input.senderDomain);
  if (owned) chain.push(owned);
  else chain.push(genericFlightExtractor);

  for (const extractor of chain) {
    const hit = extractor.extract(input);
    if (!hit) continue;
    const codes = new Set(hit.confirmationCodes);
    for (const code of findConfirmationCodes(input.text)) codes.add(code);
    return { ...hit, confirmationCodes: [...codes], extractor: extractor.id };
  }
  return null;
};

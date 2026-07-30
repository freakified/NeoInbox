/**
 * Text-tier lodging parsing: booking.com and the hotel chains whose emails
 * carry no schema.org markup (IHG measured zero in Dan's mailbox). The
 * dependable atoms are the check-in/check-out labels with a date nearby and
 * a confirmation number; the property name is fished out of the subject.
 */
import type { Extraction, Extractor, ExtractorInput } from "./types";
import { CANCEL_RE, dateNear, findConfirmationCodes, findDates } from "./text";

const CHECKIN_RE = /\bcheck[- ]?in\b/i;
const CHECKOUT_RE = /\bcheck[- ]?out\b/i;
const SUBJECT_RE =
  /\b(booking|reservation|confirmation|confirmed|your stay|itinerary)\b/i;

/** "Booking confirmed: X" / "Your reservation at X" / "Confirmation for X". */
const VENUE_FROM_SUBJECT_RE =
  /(?:confirmed[:\s]+|(?:at|for)\s+)([A-Z][^,;!(]{3,60}?)(?:\s+(?:is|has|on|from)\b|[,;!(]|$)/;

const venueOf = (subject: string): string | undefined => {
  const m = subject.match(VENUE_FROM_SUBJECT_RE);
  const venue = m?.[1]?.trim();
  if (!venue) return undefined;
  // "your booking", "your stay" etc. are not property names.
  return /^(your|the request|this)/i.test(venue) ? undefined : venue;
};

const extractLodgingText = (input: ExtractorInput): Extraction | null => {
  if (!SUBJECT_RE.test(input.subject)) return null;
  const codes = findConfirmationCodes(input.text);
  const dates = findDates(input.text, input.messageDate);
  if (!dates.length) return null;

  const checkinAt = input.text.search(CHECKIN_RE);
  const checkoutAt = input.text.search(CHECKOUT_RE);
  if (checkinAt < 0 || !codes.length) return null;

  const start = dateNear(dates, checkinAt);
  if (!start) return null;
  const end = checkoutAt >= 0 ? dateNear(dates, checkoutAt) : null;
  const venue = venueOf(input.subject);

  return {
    segments: [
      {
        kind: "lodging",
        start: start.date,
        end: end && end.date >= start.date ? end.date : undefined,
        destination: venue,
        summary: venue,
      },
    ],
    confirmationCodes: codes,
    cancelled: CANCEL_RE.test(input.subject),
  };
};

export const lodgingExtractor: Extractor = {
  id: "lodging",
  domains: [
    "booking.com",
    "ihg.com",
    "marriott.com",
    "hilton.com",
    "hyatt.com",
    "accor.com",
    "bestwestern.com",
    "choicehotels.com",
    "hotels.com",
    "vrbo.com",
    "airbnb.com",
    "expedia.com",
  ],
  extract: extractLodgingText,
};

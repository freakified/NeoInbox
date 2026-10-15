/**
 * smartEX (expy.jp) — JR Central/West's Shinkansen reservation service.
 * Booking/change/day-of-reminder emails all render the same route line:
 *   Tokyo(15:12)-->NOZOMI 43-->Kyoto(17:23)
 * alongside "Reservation number:2001" and "Departure date: Oct 4, 2024".
 * One-time-password emails from the same sender carry neither and correctly
 * fall through to "none" — there's nothing itinerary-shaped to key off.
 */
import type { Extraction, Extractor } from "./types";
import { CANCEL_RE, dateNear, findConfirmationCodes, findDates } from "./text";

const ROUTE_RE =
  /([A-Za-z][A-Za-z .'-]{1,20})\((\d{1,2}:\d{2})\)\s*-+>\s*([A-Za-z0-9 ]{1,20}?)\s*-+>\s*([A-Za-z][A-Za-z .'-]{1,20})\((\d{1,2}:\d{2})\)/;
const RESERVATION_NUMBER_RE = /reservation number\s*[:#]?\s*(\d{2,8})/i;
const SUBJECT_RE = /shinkansen reservation service/i;

export const smartexExtractor: Extractor = {
  id: "smartex",
  domains: ["expy.jp", "smart-ex.jp"],
  extract: (input): Extraction | null => {
    if (!SUBJECT_RE.test(input.subject)) return null;
    const route = input.text.match(ROUTE_RE);
    if (!route) return null;

    const [, origin, , train, destination] = route;
    const dates = findDates(input.text, input.messageDate);
    const near = dateNear(dates, route.index ?? 0);
    if (!near) return null;

    // The reservation number is a short reused slot id, not a stable locator
    // (too short to survive findConfirmationCodes' own length floor) — still
    // worth keeping in the summary, just not as a cross-trip matching code.
    const reservationNumber = input.text.match(RESERVATION_NUMBER_RE)?.[1];

    return {
      segments: [
        {
          kind: "train",
          start: near.date,
          origin: origin?.trim(),
          destination: destination?.trim(),
          summary: [
            reservationNumber ? `Shinkansen #${reservationNumber}` : "Shinkansen",
            train?.trim(),
            `${origin?.trim()} → ${destination?.trim()}`,
          ]
            .filter(Boolean)
            .join(" "),
        },
      ],
      confirmationCodes: findConfirmationCodes(input.text, input.subject),
      cancelled: CANCEL_RE.test(input.subject) || CANCEL_RE.test(input.text.slice(0, 200)),
    };
  },
};

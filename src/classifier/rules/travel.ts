import type { Features } from "../features";
import { domainMatches } from "../features";

const TRAVEL_DOMAINS = [
  "united.com", "aa.com", "delta.com", "british-airways.com", "ba.com",
  "lufthansa.com", "klm.com", "airfrance.com", "flyfrontier.com",
  "southwest.com", "jetblue.com", "alaskaair.com", "spirit.com",
  "airasia.com", "qantas.com", "cathaypacific.com", "singaporeair.com",
  "emirates.com", "qatarairways.com", "ana.co.jp", "jal.co.jp",
  "ryanair.com", "easyjet.com", "wizzair.com",
  "marriott.com", "hilton.com", "hyatt.com", "ihg.com", "accor.com",
  "bestwestern.com", "choicehotels.com", "booking.com", "hotels.com",
  "airbnb.com", "vrbo.com", "expedia.com", "tripadvisor.com",
  "hertz.com", "avis.com", "enterprise.com", "budget.com",
  "national.com", "alamo.com",
  "amtrak.com", "eurostar.com", "trainline.com",
  "uber.com", "uberrides.com", "lyft.com",
  "kayak.com", "travelocity.com", "priceline.com", "orbitz.com",
];

const TRAVEL_SUBJECT_RE =
  /\b(flight|itinerary|booking|reservation|check[- ]?in|confirmation|boarding[- ]?pass|trip|e[- ]?ticket)\b/i;

const PROMO_TRAVEL_RE =
  /(offer|deal|sale|%\s*off|earn\s+miles|earn\s+points|bonus|member\s+exclusive)/i;

export const matchesTravel = (f: Features): boolean => {
  if (domainMatches(f.senderDomain, TRAVEL_DOMAINS)) {
    if (TRAVEL_SUBJECT_RE.test(f.subject)) return true;
    if (!PROMO_TRAVEL_RE.test(f.subject)) return true;
    return false;
  }
  if (
    TRAVEL_SUBJECT_RE.test(f.subject) &&
    /^(no-?reply|noreply|notifications?|reservations?|itinerary|bookings?)/.test(
      f.senderLocalPart,
    )
  ) {
    return true;
  }
  return false;
}

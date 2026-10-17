/**
 * The travel heuristic. There is no Travel bundle; it has exactly two jobs:
 *
 *  1. In the pipeline, it files transactional travel mail (bookings,
 *     itineraries, miles posted) under Updates, ahead of the purchase and
 *     finance rules. Trip membership, not this, is what puts a booking in a
 *     trip.
 *  2. In isTripCandidate, it decides whether a message is worth fetching a
 *     body for and running the reservation extractors over.
 *
 * The second never consults the first's result, which is what keeps trip
 * detection independent of whatever bundle a route rule sends the mail to.
 */
import type { Features } from "../features";
import { domainMatches } from "../features";

const TRAVEL_DOMAINS = [
  // Airlines.
  "united.com", "aa.com", "americanairlines.com", "delta.com",
  "british-airways.com", "ba.com", "lufthansa.com", "klm.com", "airfrance.com",
  "flyfrontier.com", "southwest.com", "jetblue.com", "alaskaair.com",
  "spirit.com", "hawaiianairlines.com", "allegiantair.com", "suncountry.com",
  "aircanada.ca", "aircanada.com", "westjet.com", "flyporter.com",
  "aeromexico.com", "volaris.com", "copaair.com", "latam.com", "avianca.com",
  "gol.com.br", "azul.com.br",
  "airasia.com", "qantas.com", "virginaustralia.com", "airnewzealand.com",
  "cathaypacific.com", "singaporeair.com", "malaysiaairlines.com",
  "thaiairways.com", "vietnamairlines.com", "eva.com.tw", "china-airlines.com",
  "koreanair.com", "flyasiana.com", "airindia.com", "indigo.in", "vistara.com",
  "emirates.com", "qatarairways.com", "etihad.com", "turkishairlines.com",
  "saudia.com", "flydubai.com", "ana.co.jp", "jal.co.jp", "jal.com",
  "ryanair.com", "easyjet.com", "wizzair.com", "vueling.com", "norwegian.com",
  "iberia.com", "aerlingus.com", "tap.pt", "flysas.com", "swiss.com",
  "austrian.com", "brusselsairlines.com", "finnair.com", "icelandair.com",
  "aegeanair.com", "lot.com", "eurowings.com", "condor.com", "tui.com",
  "playflyplay.com", "airbaltic.com", "pegasus.com.tr",
  // Hotels and stays.
  "marriott.com", "marriott-email.com", "hilton.com", "hiltonhonors.com",
  "hyatt.com", "ihg.com", "accor.com", "all.accor.com", "wyndham.com",
  "wyndhamhotels.com", "radissonhotels.com", "bestwestern.com",
  "choicehotels.com", "motel6.com", "redroof.com", "loews.com",
  "fourseasons.com", "shangri-la.com", "meliahotelsinternational.com",
  "nh-hotels.com", "premierinn.com", "travelodge.co.uk", "citizenm.com",
  "booking.com", "hotels.com", "agoda.com", "trivago.com", "hostelworld.com",
  "airbnb.com", "vrbo.com", "homeaway.com", "sonder.com", "vacasa.com",
  // Agencies, aggregators and trip tools.
  "expedia.com", "tripadvisor.com", "kayak.com", "travelocity.com",
  "priceline.com", "orbitz.com", "cheaptickets.com", "hotwire.com",
  "skyscanner.net", "momondo.com", "google.com/travel", "kiwi.com",
  "gotogate.com", "opodo.com", "lastminute.com", "ebookers.com",
  "tripit.com", "tripcase.com", "hopper.com", "getyourguide.com",
  "viator.com", "klook.com", "civitatis.com", "toursbylocals.com",
  "concur.com", "navan.com", "tripactions.com", "egencia.com", "amextravel.com",
  // Cars, rail, sea and ground.
  "hertz.com", "avis.com", "enterprise.com", "budget.com", "sixt.com",
  "national.com", "alamo.com", "thrifty.com", "dollar.com", "europcar.com",
  "turo.com", "getaround.com", "zipcar.com", "discovercars.com",
  "amtrak.com", "eurostar.com", "trainline.com", "thetrainline.com",
  "raileurope.com", "viarail.ca", "sncf.com", "sncf-connect.com",
  "bahn.de", "deutschebahn.com", "italotreno.it", "trenitalia.com",
  "renfe.com", "obb.at", "sbb.ch", "nsinternational.com", "flixbus.com",
  "greyhound.com", "megabus.com", "blablacar.com",
  "royalcaribbean.com", "carnival.com", "ncl.com", "princess.com",
  "celebritycruises.com", "hollandamerica.com", "viking.com", "dfds.com",
  "brittany-ferries.com", "stenaline.com",
  "uber.com", "uberrides.com", "lyft.com", "grab.com", "bolt.eu",
  // Parking, lounges and border programmes.
  "spothero.com", "parkwhiz.com", "prioritypass.com", "loungebuddy.com",
  "cbp.dhs.gov", "ttp.dhs.gov", "clearme.com", "esta.cbp.dhs.gov",
];

const TRAVEL_SUBJECT_RE =
  /\b(flight|flights|itinerary|itineraries|booking|booked|reservation|reserved|check[- ]?in|checked[- ]?in|confirmation|confirmed|boarding[- ]?pass|trip|e[- ]?ticket|eticket|departure|departing|arrival|arriving|gate\s+change|delayed|rebook(?:ed|ing)?|upgrade\s+(?:offer|confirmed)|seat\s+assignment|baggage|checked\s+bag|rental\s+(?:car|agreement)|pick[- ]?up\s+(?:time|location)|stay\s+(?:at|with)|check[- ]?out|pnr|record\s+locator|confirmation\s+(?:code|number))\b/i;

const PROMO_TRAVEL_RE =
  /(offer|deal|sale|%\s*off|save\s+\d|earn\s+miles|earn\s+points|bonus|member\s+exclusive|last\s+chance|fares?\s+from|explore|inspire|newsletter|survey|sweepstakes)/i;

/**
 * Travel nouns that mean travel and nothing else.
 *
 * The domain branch can afford TRAVEL_SUBJECT_RE's looser wording because the
 * sender is already known to be an airline. Off the domain list there is no
 * such backstop, and matching here has a real cost: it pulls the message out
 * of every category rule behind it. "Your booking confirmation" from a hotel
 * and "Your order confirmation" from a shop differ only in the noun, so the
 * generic branch reads the noun and ignores `confirmation` entirely.
 */
const TRAVEL_STRONG_RE =
  /\b(flights?|itinerar(?:y|ies)|boarding[- ]?pass|e[- ]?ticket|eticket|booking|booked|reservation|reserved|trip|check[- ]?in|pnr|record\s+locator|departure|departing|hotel|stay|rental\s+car|car\s+rental|cruise|train|rail)\b/i;

export const matchesTravel = (f: Features): boolean => {
  if (domainMatches(f.senderDomain, TRAVEL_DOMAINS)) {
    if (TRAVEL_SUBJECT_RE.test(f.subject)) return true;
    if (!PROMO_TRAVEL_RE.test(f.subject)) return true;
    return false;
  }
  if (
    TRAVEL_STRONG_RE.test(f.subject) &&
    /^(?:no[-._]?reply|noreply|notifications?|reservations?|itinerary|bookings?|travel|trips?|flights?|guest|frontdesk|concierge|checkin)(?:[-._+]|\d|$)/.test(
      f.senderLocalPart,
    )
  ) {
    return true;
  }
  return false;
}

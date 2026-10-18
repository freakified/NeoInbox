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
  "playflyplay.com", "airbaltic.com", "pegasus.com.tr", "transavia.com",
  "volotea.com", "virginatlantic.com", "jetstar.com", "flyscoot.com",
  "cebupacificair.com", "philippineairlines.com", "starlux-airlines.com",
  "hkexpress.com", "jejuair.net", "flybreeze.com", "aveloair.com",
  "ethiopianairlines.com", "elal.com",
  "flypeach.com", "zipair.net", "zipairtokyo.com", "skymark.co.jp", "starflyer.jp",
  // Hotels and stays.
  "marriott.com", "marriott-email.com", "hilton.com", "hiltonhonors.com",
  "hyatt.com", "ihg.com", "accor.com", "all.accor.com", "wyndham.com",
  "wyndhamhotels.com", "radissonhotels.com", "bestwestern.com",
  "choicehotels.com", "motel6.com", "redroof.com", "loews.com",
  "fourseasons.com", "shangri-la.com", "meliahotelsinternational.com",
  "nh-hotels.com", "premierinn.com", "travelodge.co.uk", "citizenm.com",
  "omnihotels.com", "mgmresorts.com", "caesars.com", "mandarinoriental.com",
  "peninsula.com", "rosewoodhotels.com", "aman.com", "apahotel.com",
  "toyoko-inn.com", "hoshinoresorts.com",
  "booking.com", "hotels.com", "agoda.com", "trivago.com", "hostelworld.com",
  "airbnb.com", "vrbo.com", "homeaway.com", "sonder.com", "vacasa.com",
  "hipcamp.com", "recreation.gov", "jalan.net", "travel.rakuten.co.jp",
  "ikyu.com",
  // Agencies, aggregators and trip tools.
  "expedia.com", "tripadvisor.com", "kayak.com", "travelocity.com",
  "priceline.com", "orbitz.com", "cheaptickets.com", "hotwire.com",
  "skyscanner.net", "momondo.com", "kiwi.com", "trip.com", "ctrip.com",
  "makemytrip.com", "edreams.com", "omio.com", "jtb.co.jp", "his-j.com",
  "gotogate.com", "opodo.com", "lastminute.com", "ebookers.com",
  "tripadvisor-mail.com", "tripit.com", "tripcase.com", "hopper.com",
  "flighty.com", "flightaware.com", "wanderlog.com", "getyourguide.com",
  "viator.com", "klook.com", "civitatis.com", "toursbylocals.com",
  "concur.com", "navan.com", "tripactions.com", "egencia.com", "amextravel.com",
  // Cars, rail, sea and ground.
  "hertz.com", "avis.com", "enterprise.com", "budget.com", "sixt.com",
  "national.com", "alamo.com", "thrifty.com", "dollar.com", "europcar.com",
  "turo.com", "getaround.com", "zipcar.com", "discovercars.com",
  "rent.toyota.co.jp", "nipponrentacar.co.jp",
  "amtrak.com", "eurostar.com", "trainline.com", "thetrainline.com",
  "raileurope.com", "viarail.ca", "sncf.com", "sncf-connect.com",
  "bahn.de", "deutschebahn.com", "italotreno.it", "trenitalia.com",
  "renfe.com", "obb.at", "sbb.ch", "nsinternational.com", "ouigo.com",
  "eurail.com", "interrail.eu", "brightline.com", "irctc.co.in",
  "korail.com", "thsrc.com.tw", "eki-net.com", "smart-ex.jp", "expy.jp",
  "jr-central.co.jp", "jreast.co.jp", "westjr.co.jp",
  "flixbus.com", "greyhound.com", "megabus.com", "blablacar.com",
  "busbud.com", "wanderu.com", "12go.asia",
  "royalcaribbean.com", "carnival.com", "ncl.com", "princess.com",
  "celebritycruises.com", "hollandamerica.com", "viking.com", "dfds.com",
  "brittany-ferries.com", "stenaline.com", "msccruises.com",
  "virginvoyages.com", "cunard.com", "directferries.com",
  "uber.com", "uberrides.com", "lyft.com", "grab.com", "bolt.eu",
  "didiglobal.com", "free-now.com", "cabify.com", "careem.com",
  // Parking, lounges and border programmes.
  "spothero.com", "parkwhiz.com", "prioritypass.com", "loungebuddy.com",
  "cbp.dhs.gov", "ttp.dhs.gov", "clearme.com", "esta.cbp.dhs.gov",
  "vfsglobal.com", "ivisa.com", "vjw.digital.go.jp",
];

const TRAVEL_SUBJECT_RE =
  /\b(flight|flights|itinerary|itineraries|booking|booked|reservation|reserved|check[- ]?in|checked[- ]?in|confirmation|confirmed|boarding[- ]?pass|trip|e[- ]?ticket|eticket|departure|departing|arrival|arriving|gate\s+change|delayed|rebook(?:ed|ing)?|upgrade\s+(?:offer|confirmed)|seat\s+assignment|baggage|checked\s+bag|rental\s+(?:car|agreement)|pick[- ]?up\s+(?:time|location)|stay\s+(?:at|with)|check[- ]?out|pnr|record\s+locator|confirmation\s+(?:code|number))\b|予約(?:確認|完了|内容|番号|変更|取消|取り消し)|搭乗|航空券|旅程|チェックイン|宿泊|乗車|チケット|フライト/i;

const PROMO_TRAVEL_RE =
  /(offer|deal|sale|%\s*off|save\s+\d|earn\s+miles|earn\s+points|bonus|member\s+exclusive|last\s+chance|fares?\s+from|explore|inspir|newsletter|survey|sweepstakes|セール|キャンペーン|特典|お得|限定|クーポン|ポイント|おすすめ|特集|メルマガ|アンケート|プレゼント)/i;

/**
 * Food and grocery orders from ride-hailing brands. Uber Eats sends from
 * uber.com and GrabFood from grab.com, so the domain alone would file a
 * takeaway receipt as a trip; these step aside for Purchases instead.
 */
const DELIVERY_APP_RE = /\b(?:uber\s*eats|grab\s*(?:food|mart)|bolt\s+food)\b/i;

/**
 * Travel nouns that mean travel and nothing else.
 *
 * The domain branch can afford TRAVEL_SUBJECT_RE's looser wording because the
 * sender is already known to be an airline. Off the domain list there is no
 * such backstop, and matching here has a real cost: it pulls the message out
 * of every category rule behind it. "Your booking confirmation" from a hotel
 * and "Your order confirmation" from a shop differ only in the noun, so the
 * generic branch reads the noun and ignores `confirmation` entirely. For the
 * same reason `stay`, `train`, `rail` and `check-in` need the word that makes
 * them travel: "Stay secure", "Train your team" and a weekly team check-in
 * all come from no-reply mailboxes too.
 */
const TRAVEL_STRONG_RE =
  /\b(flights?|itinerar(?:y|ies)|boarding[- ]?pass|e[- ]?ticket|eticket|booking|booked|reservation|reserved|trip|check[- ]?in\s+(?:is\s+)?(?:now\s+)?open|pnr|record\s+locator|departure|departing|hotel|(?:your|upcoming)\s+stay|rental\s+car|car\s+rental|cruise|train\s+(?:tickets?|booking|reservation|journey)|rail\s+(?:tickets?|pass|booking|journey))\b|予約(?:確認|完了|内容|番号|変更|取消|取り消し)|搭乗|航空券|旅程|チェックイン|宿泊|新幹線|フライト|ホテル/i;

export const isTravelDomain = (domain: string): boolean =>
  domainMatches(domain, TRAVEL_DOMAINS);

export const matchesTravel = (f: Features): boolean => {
  if (isTravelDomain(f.senderDomain)) {
    if (DELIVERY_APP_RE.test(f.subject)) return false;
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

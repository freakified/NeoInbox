import type { Category } from "../shared/types";
import type { Features } from "./features";
import { matchRouteRules } from "./routeRules";
import { isBounce } from "./signals";
import { matchesForums } from "./rules/forums";
import { matchesPersonal } from "./rules/personal";
import { matchesTravel } from "./rules/travel";
import { matchesPurchases } from "./rules/purchases";
import { matchesFinance } from "./rules/finance";
import { matchesSocial } from "./rules/social";
import { matchesPromos } from "./rules/promos";
import { matchesUpdates } from "./rules/updates";
import { getTripsEnabled } from "../shared/tripsSetting";

/**
 * Changing any rule below means bumping CLASSIFIER_VERSION in ./version.
 *
 * With trips on, travel goes to Updates, as Google Inbox filed travel mail no
 * trip had claimed; with trips off it has its own Travel bundle. A booking that is in a trip still shows there: the stream groups
 * by trip membership before category. Airline marketing never gets here —
 * matchesTravel steps aside for a promotional subject, and Promos takes it.
 * It is an explicit early return so purchases and finance, whose wording
 * ("receipt", "payment") overlaps an e-ticket's, never claim a booking first.
 *
 * Trip candidacy is decided separately (see isTripCandidate) and never depends
 * on this result, so a user rule routing a travel sender elsewhere still wins
 * the bundle without disabling trip detection for that sender.
 *
 * matchesPersonal runs near the top for the same structural reason travel
 * returns null: the rules behind it claim mail on weaker evidence than a
 * domain list, so the one case they must never touch is stated once, here,
 * instead of being re-hedged in each of them. Forums still goes first —
 * every reply on a mailing list carries In-Reply-To and would otherwise read
 * as human correspondence.
 *
 * A bounce is settled just as early, as Updates: "Delivery Status
 * Notification" and "Mail delivery failed" read like parcel notices to every
 * rule behind it.
 */
export const classifyByRules = (f: Features, tripsEnabled = true): Category | null => {
  if (matchesForums(f)) return "forums";
  if (isBounce(f)) return "updates";
  if (matchesPersonal(f)) return null;
  if (matchesTravel(f)) return tripsEnabled ? "updates" : "travel";
  if (matchesPurchases(f)) return "purchases";
  if (matchesFinance(f)) return "finance";
  if (matchesSocial(f)) return "social";
  if (matchesPromos(f)) return "promos";
  if (matchesUpdates(f)) return "updates";
  return null;
}

export const classify = async (f: Features): Promise<Category | null> => {
  const [routed, tripsEnabled] = await Promise.all([matchRouteRules(f), getTripsEnabled()]);
  // "personal" is an explicit route to the unbundled inbox; it also suppresses
  // the heuristics below. A rule into Travel files where travel goes with
  // trips on, and comes back into force if they're turned off again.
  if (routed === "travel" && tripsEnabled) return "updates";
  if (routed) return routed === "personal" ? null : routed;
  return classifyByRules(f, tripsEnabled);
}

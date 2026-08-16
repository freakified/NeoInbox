import type { Category } from "../shared/types";
import type { Features } from "./features";
import { matchRouteRules } from "./routeRules";
import { matchesForums } from "./rules/forums";
import { matchesPersonal } from "./rules/personal";
import { matchesTravel } from "./rules/travel";
import { matchesPurchases } from "./rules/purchases";
import { matchesFinance } from "./rules/finance";
import { matchesSocial } from "./rules/social";
import { matchesPromos } from "./rules/promos";
import { matchesUpdates } from "./rules/updates";

/**
 * Changing any rule below means bumping CLASSIFIER_VERSION in ./version.
 *
 * Travel yields null rather than a category: there is no Travel bundle, so
 * itinerary mail belongs loose in the inbox until a trip claims it. It has to
 * be an explicit early return, not an omission — drop it and a booking
 * confirmation falls through to matchesUpdates and gets buried in Updates,
 * which is the one place an unclustered reservation must never end up.
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
 */
export const classifyByRules = (f: Features): Category | null => {
  if (matchesForums(f)) return "forums";
  if (matchesPersonal(f)) return null;
  if (matchesTravel(f)) return null;
  if (matchesPurchases(f)) return "purchases";
  if (matchesFinance(f)) return "finance";
  if (matchesSocial(f)) return "social";
  if (matchesPromos(f)) return "promos";
  if (matchesUpdates(f)) return "updates";
  return null;
}

export const classify = async (f: Features): Promise<Category | null> => {
  const routed = await matchRouteRules(f);
  // "personal" is an explicit route to the unbundled inbox; it also suppresses
  // the heuristics below.
  if (routed) return routed === "personal" ? null : routed;
  return classifyByRules(f);
}

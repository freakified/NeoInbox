import type { Category } from "../shared/types";
import type { Features } from "./features";
import { matchRouteRules } from "./routeRules";
import { matchesForums } from "./rules/forums";
import { matchesTravel } from "./rules/travel";
import { matchesPurchases } from "./rules/purchases";
import { matchesFinance } from "./rules/finance";
import { matchesSocial } from "./rules/social";
import { matchesPromos } from "./rules/promos";
import { matchesUpdates } from "./rules/updates";

/** Changing any rule below means bumping CLASSIFIER_VERSION in ./version. */
export const classifyByRules = (f: Features): Category | null => {
  if (matchesForums(f)) return "forums";
  if (matchesTravel(f)) return "travel";
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

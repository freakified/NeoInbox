import type { Category } from "../shared/types";
import type { Features } from "./features";
import { matchesForums } from "./rules/forums";
import { matchesTravel } from "./rules/travel";
import { matchesPurchases } from "./rules/purchases";
import { matchesFinance } from "./rules/finance";
import { matchesSocial } from "./rules/social";
import { matchesPromos } from "./rules/promos";
import { matchesUpdates } from "./rules/updates";

export function classify(f: Features): Category | null {
  if (matchesForums(f)) return "forums";
  if (matchesTravel(f)) return "travel";
  if (matchesPurchases(f)) return "purchases";
  if (matchesFinance(f)) return "finance";
  if (matchesSocial(f)) return "social";
  if (matchesPromos(f)) return "promos";
  if (matchesUpdates(f)) return "updates";
  return null;
}

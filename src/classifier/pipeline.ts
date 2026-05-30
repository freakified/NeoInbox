import type { Category } from "../shared/types";
import type { Features } from "./features";
import { matchesBundleRules } from "./bundleRules";
import { lookupOverride } from "./overrides";
import { matchesCustomBundles } from "./customBundles";
import { matchesForums } from "./rules/forums";
import { matchesTravel } from "./rules/travel";
import { matchesPurchases } from "./rules/purchases";
import { matchesFinance } from "./rules/finance";
import { matchesSocial } from "./rules/social";
import { matchesPromos } from "./rules/promos";
import { matchesUpdates } from "./rules/updates";

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
  const specificBundleRule = await matchesBundleRules(f, ["subject_keyword", "email"]);
  if (specificBundleRule) return specificBundleRule;
  const override = await lookupOverride(f.senderDomain);
  if (override) return override;
  const bundleRule = await matchesBundleRules(f, ["domain"]);
  if (bundleRule) return bundleRule;
  const custom = await matchesCustomBundles(f);
  if (custom) return custom;
  return classifyByRules(f);
}

import { db } from "../store/db";
import { matchingRouteRules } from "../shared/routeRules";
import type { Category, RouteRuleRecord } from "../shared/types";
import type { Features } from "./features";

let cache: RouteRuleRecord[] | null = null;
let epoch = 0;

export const invalidateRouteRules = (): void => {
  cache = null;
  epoch++;
};

const loadRules = async (): Promise<RouteRuleRecord[]> => {
  if (cache) return cache;
  const startedAt = epoch;
  const rules = await db.routeRules.toArray();
  // An invalidation while the read was in flight means `rules` may predate
  // the write that triggered it; serve it once but don't cache it.
  if (epoch === startedAt) cache = rules;
  return rules;
};

/** Precedence lives in matchingRouteRules so the SPA can explain it. */
export const matchRouteRules = async (f: Features): Promise<Category | null> => {
  const rules = await loadRules();
  return matchingRouteRules(rules, f)[0]?.target ?? null;
};

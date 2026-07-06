import { db } from "../store/db";
import { matchingRouteRules } from "../shared/routeRules";
import type { Category, RouteRuleRecord } from "../shared/types";
import type { Features } from "./features";

let cache: RouteRuleRecord[] | null = null;

export const invalidateRouteRules = (): void => {
  cache = null;
};

const loadRules = async (): Promise<RouteRuleRecord[]> => {
  cache ??= await db.routeRules.toArray();
  return cache;
};

/** Precedence lives in matchingRouteRules so the SPA can explain it. */
export const matchRouteRules = async (f: Features): Promise<Category | null> => {
  const rules = await loadRules();
  return matchingRouteRules(rules, f)[0]?.target ?? null;
};

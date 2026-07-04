import { db } from "../store/db";
import type { Category, RouteRuleRecord } from "../shared/types";
import { domainMatches } from "./features";
import type { Features } from "./features";

let cache: RouteRuleRecord[] | null = null;

export const invalidateRouteRules = (): void => {
  cache = null;
};

const loadRules = async (): Promise<RouteRuleRecord[]> => {
  cache ??= await db.routeRules.toArray();
  return cache;
};

const newestFirst = (a: RouteRuleRecord, b: RouteRuleRecord): number =>
  b.createdAt - a.createdAt;

/**
 * Deterministic precedence: exact sender email, then sender domain (a rule for
 * mail.example.com beats one for example.com), then subject keyword. Ties go
 * to the most recently created rule.
 */
export const matchRouteRules = async (f: Features): Promise<Category | null> => {
  const rules = await loadRules();

  const email = rules
    .filter((r) => r.type === "email" && r.value === f.senderEmail)
    .sort(newestFirst)[0];
  if (email) return email.target;

  const domain = rules
    .filter((r) => r.type === "domain" && domainMatches(f.senderDomain, [r.value]))
    .sort((a, b) => b.value.length - a.value.length || newestFirst(a, b))[0];
  if (domain) return domain.target;

  const subject = f.subject.toLowerCase();
  const keyword = rules
    .filter((r) => r.type === "subject_keyword" && subject.includes(r.value))
    .sort(newestFirst)[0];
  if (keyword) return keyword.target;

  return null;
};

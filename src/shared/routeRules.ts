import type { RouteRuleRecord, RouteRuleType } from "./types";

export const ruleTypeLabel: Record<RouteRuleType, string> = {
  domain: "Domain",
  email: "Email",
  subject_keyword: "Subject contains",
};

export const normalizeRuleValue = (type: RouteRuleType, value: string): string => {
  let trimmed = value.trim().toLowerCase();
  if (type === "subject_keyword") {
    trimmed = trimmed
      .replace(/^\/\.\*/, "")
      .replace(/\.\*\/$/, "")
      .replace(/^\.\*/, "")
      .replace(/\.\*$/, "")
      .trim();
  }
  if (type === "domain") return trimmed.replace(/^@/, "");
  return trimmed;
};

/** The rule currently claiming this (type, value) routing key, if any. */
export const findRouteRule = (
  rules: readonly RouteRuleRecord[],
  type: RouteRuleType,
  value: string,
): RouteRuleRecord | undefined =>
  rules.find((r) => r.type === type && r.value === normalizeRuleValue(type, value));

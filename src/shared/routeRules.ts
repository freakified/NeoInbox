import { parseSender } from "./senders";
import type { MessageOrigin, RouteRuleRecord, RouteRuleType } from "./types";

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

export const domainMatches = (domain: string, list: readonly string[]): boolean =>
  list.some((d) => domain === d || domain.endsWith("." + d));

export interface RouteMatchInput {
  senderEmail: string;
  senderDomain: string;
  subject: string;
}

const newestFirst = (a: RouteRuleRecord, b: RouteRuleRecord): number =>
  b.createdAt - a.createdAt;

/**
 * Every rule matching this message, winner first. Deterministic precedence:
 * exact sender email, then sender domain (a rule for mail.example.com beats
 * one for example.com), then subject keyword. Ties go to the most recently
 * created rule.
 */
export const matchingRouteRules = (
  rules: readonly RouteRuleRecord[],
  input: RouteMatchInput,
): RouteRuleRecord[] => {
  const subject = input.subject.toLowerCase();
  const emails = rules
    .filter((r) => r.type === "email" && r.value && r.value === input.senderEmail)
    .sort(newestFirst);
  const domains = rules
    .filter((r) => r.type === "domain" && domainMatches(input.senderDomain, [r.value]))
    .sort((a, b) => b.value.length - a.value.length || newestFirst(a, b));
  const keywords = rules
    .filter((r) => r.type === "subject_keyword" && r.value && subject.includes(r.value))
    .sort(newestFirst);
  return [...emails, ...domains, ...keywords];
};

export interface RuleMatchable {
  origin: MessageOrigin;
  subject: string;
  author: string;
}

/**
 * Whether a message would route through this (type, value) key. Shared by
 * the background reclassify sweep and the SPA's rule-creation match-count
 * preview so the two never drift apart.
 */
export const ruleMatchesMessage = (
  rule: Pick<RouteRuleRecord, "type" | "value">,
  msg: RuleMatchable,
): boolean => {
  if (msg.origin !== "inbox" || !rule.value) return false;
  if (rule.type === "subject_keyword") return msg.subject.toLowerCase().includes(rule.value);
  const sender = parseSender(msg.author);
  if (rule.type === "email") return sender.email === rule.value;
  return domainMatches(sender.domain, [rule.value]);
};

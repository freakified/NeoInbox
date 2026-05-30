import { db } from "../store/db";
import type { BuiltinCategory, CustomBundleRule } from "../shared/types";
import { domainMatches } from "./features";
import type { Features } from "./features";

type RuleType = CustomBundleRule["type"];

const RULE_SPECIFICITY: Record<CustomBundleRule["type"], number> = {
  subject_keyword: 0,
  email: 1,
  domain: 2,
};

export const matchesBundleRules = async (
  f: Features,
  allowedTypes?: readonly RuleType[],
): Promise<BuiltinCategory | null> => {
  const allowed = allowedTypes ? new Set(allowedTypes) : null;
  const rules = (await db.bundleRules.toArray()).filter((row) => !allowed || allowed.has(row.rule.type)).sort(
    (a, b) => RULE_SPECIFICITY[a.rule.type] - RULE_SPECIFICITY[b.rule.type],
  );
  for (const row of rules) {
    const rule = row.rule;
    if (rule.type === "domain" && domainMatches(f.senderDomain, [rule.value])) return row.category;
    if (rule.type === "email" && f.senderEmail === rule.value.toLowerCase()) return row.category;
    if (rule.type === "subject_keyword" && f.subject.toLowerCase().includes(rule.value.toLowerCase())) {
      return row.category;
    }
  }
  return null;
};

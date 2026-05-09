import { db } from "../store/db";
import type { BuiltinCategory } from "../shared/types";
import { domainMatches } from "./features";
import type { Features } from "./features";

export const matchesBundleRules = async (f: Features): Promise<BuiltinCategory | null> => {
  const rules = await db.bundleRules.toArray();
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

import { db } from "../store/db";
import { domainMatches } from "./features";
import type { Features } from "./features";

export const matchesCustomBundles = async (f: Features): Promise<string | null> => {
  const bundles = (await db.customBundles.toArray()).sort((a, b) => a.order - b.order);
  for (const bundle of bundles) {
    for (const rule of bundle.rules) {
      if (rule.type === "domain" && domainMatches(f.senderDomain, [rule.value])) return bundle.id;
      if (rule.type === "email" && f.senderEmail === rule.value.toLowerCase()) return bundle.id;
      if (rule.type === "subject_keyword" && f.subject.toLowerCase().includes(rule.value.toLowerCase())) return bundle.id;
    }
  }
  return null;
}

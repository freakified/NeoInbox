import type { Features } from "../features";
import { domainMatches } from "../features";

const FORUM_DOMAINS = ["googlegroups.com", "groups.io", "listserv.com"];

export const matchesForums = (f: Features): boolean => {
  if (f.hasListPost || f.hasMailingList) return true;
  if (domainMatches(f.senderDomain, FORUM_DOMAINS)) return true;
  return false;
}

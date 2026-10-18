import { normalizeRuleValue } from "../../shared/routeRules";
import { suggestRuleType } from "../../shared/ruleSuggestion";
import { parseSender } from "../../shared/senders";
import type { Category, RouteRuleType, Thread } from "../../shared/types";

/**
 * One row of the bulk move dialog: the selected conversations a single rule
 * choice covers. Senders at an organization's domain share a row (one domain
 * rule moves them all); senders at a shared provider like gmail.com each get
 * their own, since a gmail.com domain rule would sweep in strangers.
 */
export interface BulkMoveGroup {
  id: string;
  /** Empty when the sender address has no domain part. */
  domain: string;
  /** Distinct sender addresses in the group, sorted. */
  emails: string[];
  threads: Thread[];
  suggested: "domain" | "email";
}

export interface BulkMovePlan {
  groups: BulkMoveGroup[];
  /** Already in the destination; nothing to do. */
  alreadyThere: Thread[];
  /** No sender address to build a rule from, so they stay where they are. */
  unroutable: Thread[];
}

/** Same sender a single-conversation move builds its rule from. */
const senderOf = (thread: Thread) => parseSender(thread.messages[0]?.author ?? "");

export const planBulkMove = (threads: readonly Thread[], target: Category): BulkMovePlan => {
  const byId = new Map<string, BulkMoveGroup>();
  const alreadyThere: Thread[] = [];
  const unroutable: Thread[] = [];

  for (const thread of threads) {
    if ((thread.category ?? "personal") === target) {
      alreadyThere.push(thread);
      continue;
    }
    const sender = senderOf(thread);
    if (!sender.email) {
      unroutable.push(thread);
      continue;
    }
    const suggested = sender.domain ? suggestRuleType(sender.domain) : "email";
    const id = suggested === "domain" ? `domain:${sender.domain}` : `email:${sender.email}`;
    const group = byId.get(id) ?? { id, domain: sender.domain, emails: [], threads: [], suggested };
    if (!group.emails.includes(sender.email)) group.emails.push(sender.email);
    group.threads.push(thread);
    byId.set(id, group);
  }

  const groups = [...byId.values()];
  for (const g of groups) g.emails.sort();
  // Biggest groups first: they're the rules that matter most.
  groups.sort((a, b) => b.threads.length - a.threads.length || a.id.localeCompare(b.id));
  return { groups, alreadyThere, unroutable };
};

/** The rules a group produces for a choice: one domain rule, or one per sender. */
export const rulesForGroup = (
  group: BulkMoveGroup,
  type: "domain" | "email",
): { type: RouteRuleType; value: string }[] =>
  type === "domain" && group.domain
    ? [{ type: "domain", value: normalizeRuleValue("domain", group.domain) }]
    : group.emails.map((email) => ({ type: "email", value: normalizeRuleValue("email", email) }));

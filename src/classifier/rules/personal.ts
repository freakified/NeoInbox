/**
 * The guard in front of every other rule: mail that is a person talking to
 * you, which must stay loose in the inbox no matter what its subject says.
 *
 * It exists because the rules behind it got much broader. Once a shared role
 * mailbox plus a keyword is enough to bundle a message, "Re: your invoice"
 * from the accountant you are mid-thread with is one rule away from being
 * filed into Purchases. Rather than hedge every rule, human correspondence is
 * recognised once, here, and returned unbundled.
 *
 * Both paths are deliberately narrow — a false positive here suppresses
 * bundling entirely, which is the one failure mode that leaves the inbox
 * looking unclassified.
 */
import type { Features } from "../features";
import { isBulk, looksLikePerson, MACHINE_SENDER_RE } from "../signals";
import { isSharedMailboxDomain } from "../../shared/ruleSuggestion";

export const matchesPersonal = (f: Features): boolean => {
  // Anything list-borne belongs to Forums or Updates, never here: list mail
  // carries In-Reply-To on every reply and would otherwise all read as human.
  if (f.hasListPost || f.hasMailingList || f.listId) return false;
  if (f.hasListUnsubscribe || f.bulkPrecedence) return false;
  if (f.autoSubmitted) return false;
  if (MACHINE_SENDER_RE.test(f.senderLocalPart)) return false;

  // A turn in a thread. Campaign fingerprints don't veto this one: support
  // desks relay genuine replies through bulk platforms, and burying a reply
  // you are waiting on is worse than leaving one ticket notice unbundled.
  if (f.isReply) return true;

  // A named human, from anywhere. This is what keeps a colleague writing from
  // a bank's domain out of Finance.
  if (looksLikePerson(f) && !isBulk(f)) return true;

  // A consumer webmail address with no bulk marker of any kind: gmail.com and
  // its neighbours are where people mail from, not where brands mail from.
  if (isSharedMailboxDomain(f.senderDomain) && !isBulk(f)) return true;

  return false;
}

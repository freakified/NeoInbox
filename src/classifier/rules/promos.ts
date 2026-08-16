/**
 * Marketing: mail sent to sell you something.
 *
 * The gate is always bulk — a promotional-sounding subject from a person is a
 * person talking about a sale. Beyond that there are two ways in: the subject
 * reads like an offer, or the sender is literally the marketing mailbox.
 *
 * Promos deliberately sits behind Purchases, Finance and Social so that a
 * retailer's shipping notice, a bank's statement and a network's upsell each
 * stay with the rest of that sender's mail.
 */
import type { Features } from "../features";
import { isBulk } from "../signals";

export const PROMO_SUBJECT_RE =
  /(\d+%\s*off|%\s*off|\$\d+\s*off|\bsale\b|\bdeals?\b|\bsave\b|\bsavings\b|\bcoupon\b|promo\s*code|discount|limited[- ]time|new\s+arrivals?|exclusive|free\s+shipping|free\s+gift|today\s+only|flash\s+sale|clearance|bogo|buy\s+one|ends\s+(?:tonight|soon|today|tomorrow|this)|last\s+chance|final\s+hours|don'?t\s+miss|hurry|just\s+for\s+you|members?\s+only|early\s+access|shop\s+now|price\s+drop|lowest\s+price|best\s+price|up\s+to\s+\d+%|sitewide|storewide|black\s+friday|cyber\s+monday|prime\s+day|boxing\s+day|back\s+in\s+stock|restock|new\s+season|sneak\s+peek|giveaway|sweepstakes|enter\s+to\s+win|win\s+a\b|treat\s+yourself|introducing\s+the|just\s+dropped|new\s+collection|gift\s+guide|last\s+day)/i;

/**
 * Sender mailboxes whose entire purpose is campaigns. Newsletter-shaped
 * mailboxes (`newsletter@`, `weekly@`, `digest@`) are left out on purpose: a
 * newsletter with nothing promotional in it belongs in Updates, and the
 * subject rule above already claims the ones that are selling.
 */
const PROMO_SENDER_RE =
  /^(?:marketing|promo|promos|promotions|offers?|deals?|sale|sales|specials|savings|discounts?|campaign|shop|store)(?:[-._+]|\d|$)/;

/**
 * Wording that means a message is transactional even though it looks like a
 * campaign. "Your order is on sale" is not a campaign; "your receipt" from a
 * bulk sender is a receipt. Purchases and Finance normally take these first,
 * but a sender not on any list reaches here, and Updates is the safer home.
 */
const TRANSACTIONAL_OVERRIDE_RE =
  /\b(receipt|invoice|your\s+order|shipped|delivered|refund|password|verification|security\s+alert|sign[- ]in|two[- ]factor|appointment|statement)\b/i;

export const matchesPromos = (f: Features): boolean => {
  if (!isBulk(f)) return false;
  if (TRANSACTIONAL_OVERRIDE_RE.test(f.subject)) return false;
  if (PROMO_SUBJECT_RE.test(f.subject)) return true;
  return PROMO_SENDER_RE.test(f.senderLocalPart);
}

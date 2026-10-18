/**
 * Marketing: mail sent to sell you something.
 *
 * The gate is always bulk — a promotional-sounding subject from a person is a
 * person talking about a sale. Beyond that there are three ways in: the
 * subject reads like an offer, the sender is literally the marketing mailbox,
 * or the sender is a brand on the retail, travel or finance list.
 *
 * Promos deliberately sits behind Purchases, Finance and Social so that a
 * retailer's shipping notice, a bank's statement and a network's upsell each
 * stay with the rest of that sender's mail.
 */
import type { Features } from "../features";
import { isBulk, PROMO_SUBJECT_RE } from "../signals";
import { isFinanceDomain } from "./finance";
import { isRetailDomain } from "./purchases";
import { isTravelDomain } from "./travel";

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
  /\b(receipt|invoice|your\s+order|shipped|delivered|refund|password|verification|security\s+alert|sign[- ]in|two[- ]factor|appointment|statement|your\s+(?:\w+\s+)?account|privacy\s+(?:policy|notice)|terms\s+(?:of|and)|policy\s+update|(?:membership|subscription)\s+(?:renew\w*|expir\w*|cancel\w*))\b|領収書|ご注文|発送|配達|パスワード|認証|ログイン|明細|規約/i;

/**
 * A known brand sending in bulk, on a subject its own rule passed over.
 *
 * Each domain rule claims everything a brand sends except what it reads as
 * marketing — an airline's "Explore new destinations", a bank's pre-approval,
 * a retailer's "Fresh fits for fall" — and that is exactly what reaches here.
 * Their wording is too varied for PROMO_SUBJECT_RE; the sender plus the bulk
 * run is the evidence.
 */
const isBrandDomain = (domain: string): boolean =>
  isRetailDomain(domain) || isTravelDomain(domain) || isFinanceDomain(domain);

export const matchesPromos = (f: Features): boolean => {
  if (!isBulk(f)) return false;
  if (TRANSACTIONAL_OVERRIDE_RE.test(f.subject)) return false;
  if (PROMO_SUBJECT_RE.test(f.subject)) return true;
  if (isBrandDomain(f.senderDomain)) return true;
  return PROMO_SENDER_RE.test(f.senderLocalPart);
}

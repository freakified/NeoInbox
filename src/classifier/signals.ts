/**
 * Vocabulary shared by more than one rule.
 *
 * The category rules used to key on two things only: a domain list and a
 * subject keyword. That left a large middle ground unclaimed — the mail that
 * comes from an organisation rather than a person but isn't from a brand big
 * enough to be on a list, which is most of a real inbox. These predicates are
 * what the rules use to recognise that mail: who sent it (machine, shared org
 * mailbox, or a human) and how it was sent (one-to-one, or a bulk run).
 *
 * Everything here is header- and address-only, like the rest of the
 * classifier: no bodies are read, so nothing here can be defeated by a message
 * that hasn't synced yet.
 */
import type { Features } from "./features";

/**
 * Local parts that mean "a machine sent this, and replying goes nowhere".
 * Matched as a prefix, so `no-reply+tag`, `notifications-noreply` and
 * `auto-confirm` all land here.
 *
 * The separator class is [-._] throughout: senders spell the same mailbox
 * `no-reply`, `no.reply` and `no_reply`, and `no.reply.alerts@chase.com` is a
 * real address from the corpus.
 */
export const MACHINE_SENDER_RE =
  /^(no[-._]?reply|noreply|do[-._]?not[-._]?reply|donotreply|unmonitored|auto|automated|automatic|autoreply|autoresponder|mailer[-._]?daemon|maildaemon|postmaster|bounce|bounces|daemon|robot|mailbot|bot|system|sysadmin|nobody|notify|notification|notifications|notifier|alert|alerts|noticias)(?:[-._+]|\d|$)/;

/**
 * Local parts that mean "an organisation sent this", whether or not a human
 * typed it. A shared mailbox is the strongest cheap signal that mail is not
 * personal correspondence, and it is what lets the rules below claim mail from
 * the millions of senders no domain list will ever cover.
 */
export const ROLE_SENDER_RE =
  /^(support|help|helpdesk|service|services|customer|customercare|customerservice|care|contact|hello|hey|hi|team|info|information|admin|administrator|office|sales|marketing|promo|promotions|offers|deals|billing|bill|invoice|invoices|invoicing|statements?|e[-.]?statements?|account|accounts|accounting|payment|payments|payables|receivable|security|privacy|legal|compliance|hr|people|careers|jobs|recruiting|recruitment|membership|member|members|subscription|subscriptions|renewals|order|orders|receipt|receipts|returns|shipment|shipping|ship|delivery|deliveries|tracking|fulfillment|store|shop|news|newsletter|press|media|digest|updates|update|status|tickets?|mail|email|messages|message|inbox|community|forum|events|event|webinar|welcome|onboarding|feedback|survey|reminder|reminders|appointment|appointments|booking|bookings|reservation|reservations|itinerary|confirm|confirmation|confirmations|verify|verification|register|registration|registrar|admissions|enrollment|frontdesk|front[-.]?desk|reception|clinic|patient|patients|pharmacy|mychart|rent|rents|rental|rentals|leasing|property|parking|utility|utilities|donate|donations|giving|fundraising|volunteer|library|alumni|noreply2|donotrespond)(?:[-._+]|\d|$)/;

/**
 * A bounce: the mail server telling you something you sent never arrived.
 *
 * It reads like a parcel notice ("Delivery Status Notification", "Mail
 * delivery failed") and comes from a machine, so without this it lands in
 * Purchases; the pipeline files it under Updates before that can happen.
 * RFC 3464 reports say so in their Content-Type; the sender and subject cover
 * servers that omit it.
 */
const BOUNCE_SENDER_RE = /^(?:mailer[-._]?daemon|maildaemon|postmaster)(?:[-._+]|\d|$)/;
const BOUNCE_SUBJECT_RE =
  /\b(?:undeliverable|undelivered\s+mail|delivery\s+status\s+notification|delivery\s+(?:has\s+)?failed|delivery\s+failure|mail\s+delivery\s+(?:failed|failure|subsystem)|returned\s+mail|failure\s+notice)\b|配信エラー|配信不能/i;

export const isBounce = (f: Features): boolean => {
  if (/report-type\s*=\s*"?delivery-status/i.test(f.headers["content-type"]?.[0] ?? "")) return true;
  return BOUNCE_SENDER_RE.test(f.senderLocalPart) && BOUNCE_SUBJECT_RE.test(f.subject);
};

/**
 * Subjects that read like an offer. Shared because Purchases has to hand
 * these back before Promos ever sees them ("free shipping this weekend"
 * contains a purchase noun), and Promos claims on them.
 *
 * Japanese terms sit outside the \b groups: \b only knows ASCII word
 * characters, so it never matches next to kana or kanji.
 */
export const PROMO_SUBJECT_RE =
  /(\d+%\s*off|%\s*off|\$\d+\s*off|\bsale\b|\bdeals?\b|\bsave\b|\bsavings\b|\bcoupon\b|promo\s*code|discount|limited[- ]time|new\s+arrivals?|exclusive|free\s+shipping|free\s+gift|\bfor\s+free\b|\b\d+\s+months?\s+(?:free|for\s+[$€£¥]?\d)|today\s+only|flash\s+sale|clearance|bogo|buy\s+one|ends\s+(?:tonight|soon|today|tomorrow|this)|last\s+chance|final\s+hours|don'?t\s+miss|hurry|just\s+for\s+you|members?\s+only|early\s+access|shop\s+now|price\s+drop|lowest\s+price|best\s+price|up\s+to\s+\d+%|sitewide|storewide|black\s+friday|cyber\s+monday|prime\s+day|boxing\s+day|back\s+in\s+stock|restock|new\s+season|sneak\s+peek|giveaway|sweepstakes|enter\s+to\s+win|win\s+a\b|treat\s+yourself|introducing\s+the|just\s+dropped|new\s+collection|gift\s+guide|last\s+day|セール|クーポン|割引|特価|お得|キャンペーン|期間限定|数量限定|送料無料|ポイント\d*倍|新商品|新着|先行販売|プレゼント|抽選|タイムセール|最大\d+%)/i;

/**
 * Bulk mail: sent to a list rather than to you.
 *
 * List-Unsubscribe is the classic marker and remains the strongest, but plenty
 * of bulk mail omits it, which is exactly the mail that used to fall through
 * to no bundle at all. `Precedence: bulk|list|junk` and platform fingerprints
 * cover most of the rest.
 */
export const isBulk = (f: Features): boolean =>
  f.hasListUnsubscribe || f.bulkPrecedence || f.campaignHeaders;

/**
 * True when the message came from an organisation rather than a person: a
 * machine mailbox, a shared role mailbox, an RFC 3834 auto-generated message,
 * or a bulk run.
 *
 * This is the gate on every subject-keyword rule that isn't backed by a domain
 * list. Subject keywords alone must never bundle mail — "did my order ever
 * show up?" from a friend is not a purchase — so each of those rules asks for
 * a keyword *and* a sender that isn't a human.
 */
export const isOrganizationalSender = (f: Features): boolean =>
  MACHINE_SENDER_RE.test(f.senderLocalPart) ||
  ROLE_SENDER_RE.test(f.senderLocalPart) ||
  f.autoSubmitted ||
  isBulk(f);

/** Tokens that disqualify a local part from looking like a person's name. */
const NON_PERSON_TOKEN = new Set([
  "no", "not", "do", "dont", "reply", "noreply", "mail", "email", "inbox",
  "team", "support", "help", "info", "news", "newsletter", "sales", "service",
  "customer", "care", "billing", "invoice", "account", "accounts", "admin",
  "office", "orders", "order", "shop", "store", "delivery", "shipping",
  "alerts", "alert", "notify", "notification", "notifications", "updates",
  "update", "marketing", "offers", "deals", "promo", "promotions", "hello",
  "contact", "security", "privacy", "legal", "app", "web", "auto", "bot",
  "system", "daemon", "robot", "confirm", "confirmation", "booking",
  "bookings", "reservation", "reservations", "receipt", "receipts", "play",
  "store2", "care2", "the", "my", "your", "get", "go", "join", "try",
]);

/**
 * `first.last`, `first_last`, `f.last2`. Hyphens are excluded on purpose:
 * `rust-users@googlegroups.com` and `dev-team@` are hyphenated far more often
 * than people are, and a mailing list read as a person would be unbundled
 * rather than filed into Forums.
 */
const PERSON_LOCAL_RE = /^[a-z]{2,}(?:[._][a-z]{2,}){1,2}\d{0,4}$/;

/**
 * A `firstname.lastname` sender that isn't the brand talking.
 *
 * Corporate mail is overwhelmingly `first.last@company.com`, and a colleague
 * writing from a bank's domain is a person, not a bank statement. The guard
 * against `google.play@google.com` is that a real person's name does not
 * repeat their employer's domain, so any token that also appears as a label in
 * the sender's domain disqualifies the address.
 */
export const isPersonLocalPart = (localPart: string, domain: string): boolean => {
  if (!PERSON_LOCAL_RE.test(localPart)) return false;
  const domainLabels = new Set(domain.split("."));
  for (const token of localPart.replace(/\d+$/, "").split(/[._]/)) {
    if (NON_PERSON_TOKEN.has(token)) return false;
    if (domainLabels.has(token)) return false;
  }
  return true;
};

export const looksLikePerson = (f: Features): boolean =>
  isPersonLocalPart(f.senderLocalPart, f.senderDomain);

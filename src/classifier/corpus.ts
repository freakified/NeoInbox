/**
 * A corpus of real-shaped messages and the category they belong in.
 *
 * The classifier only ever reads the sender, the subject and the full headers
 * (see extractFeatures), so a case needs nothing else — no bodies, no
 * attachments, nothing identifying. That makes this cheap to grow: every time
 * a message lands in the wrong bundle, add the case here first, then fix the
 * rule.
 *
 * Capture real cases from your own mail with `neoClassifyDump()` in the
 * background console; it emits entries in exactly this shape.
 */
export interface CorpusCase {
  /** What this case is about, used as the test name. */
  name: string;
  author: string;
  subject: string;
  /** Full headers as getFull returns them; the List-* ones drive most rules. */
  headers?: Record<string, string[]>;
  /** null means "no bundle" — it belongs loose in the inbox. */
  expect: string | null;
}

const listUnsubscribe = { "List-Unsubscribe": ["<https://example.com/u>"] };

export const corpus: CorpusCase[] = [
  // ---------------------------------------------------------------- forums
  {
    name: "a mailing list post carrying List-Post",
    author: "Dev List <dev@lists.example.org>",
    subject: "Re: [PATCH v2] fix the thing",
    headers: {
      "List-Post": ["<mailto:dev@lists.example.org>"],
      "List-Id": ["dev.lists.example.org"],
      ...listUnsubscribe,
    },
    expect: "forums",
  },
  {
    name: "a Google Group, by sender domain alone",
    author: "Rust Users <rust-users@googlegroups.com>",
    subject: "Question about lifetimes",
    expect: "forums",
  },
  {
    name: "a list post outranks its unsubscribe header",
    // Nearly every list carries List-Unsubscribe too; forums must win or all
    // discussion mail would collapse into updates.
    author: "Announce <announce@groups.io>",
    subject: "Monthly meetup",
    headers: { "Mailing-List": ["list announce@groups.io"], ...listUnsubscribe },
    expect: "forums",
  },

  // ---------------------------------------------------------------- travel
  // There is no Travel bundle: itinerary mail belongs to the trips layer, and
  // until it lands in a trip it sits loose in the inbox. So the interesting
  // assertion for these is trip candidacy, not category — see tripCandidacy.
  {
    name: "an airline itinerary from a sending subdomain",
    author: "United Airlines <no-reply@email.united.com>",
    subject: "Your itinerary for SFO to LHR",
    expect: null,
  },
  {
    name: "a hotel booking confirmation",
    author: "Marriott <reservations@email.marriott.com>",
    subject: "Reservation confirmed — Lisbon, 14 Sep",
    expect: null,
  },
  {
    name: "a booking confirmation from an unknown travel brand",
    // Not on the domain list, so it rides on the subject plus a no-reply-ish
    // sender — which is how most smaller operators send.
    author: "Bookings <bookings@some-boutique-hotel.example>",
    subject: "Your booking confirmation",
    expect: null,
  },
  {
    name: "an airline fare sale is not itinerary mail",
    author: "United Airlines <deals@email.united.com>",
    subject: "Flash sale: 30% off fares this week only",
    headers: listUnsubscribe,
    expect: "promos",
  },

  // ------------------------------------------------------------- purchases
  {
    name: "a retailer order confirmation",
    author: "Amazon.com <auto-confirm@amazon.com>",
    subject: "Your Amazon.com order of \"USB-C cable\"",
    expect: "purchases",
  },
  {
    name: "a shipping carrier notice, whatever the subject",
    author: "UPS Quantum View <auto-notify@ups.com>",
    subject: "UPS Update: Package scheduled for delivery",
    expect: "purchases",
  },
  {
    name: "a receipt from an unknown store",
    author: "Orders <orders@tiny-shop.example>",
    subject: "Your receipt from Tiny Shop",
    expect: "purchases",
  },
  {
    name: "a retailer newsletter is not a purchase",
    author: "Target <news@e.target.com>",
    subject: "New arrivals for spring",
    headers: listUnsubscribe,
    expect: "promos",
  },

  // --------------------------------------------------------------- finance
  {
    name: "a bank statement notice",
    author: "Chase <no.reply.alerts@chase.com>",
    subject: "Your statement is ready",
    expect: "finance",
  },
  {
    name: "a payment app transaction",
    author: "Venmo <venmo@venmo.com>",
    subject: "You paid Alex $20.00",
    headers: listUnsubscribe,
    expect: "finance",
  },
  {
    name: "a credit card acquisition offer is not account activity",
    author: "Chase <newoffers@chase.com>",
    subject: "Apply now for the new Sapphire card",
    headers: listUnsubscribe,
    expect: "updates",
  },

  // ---------------------------------------------------------------- social
  {
    name: "a social network notification",
    author: "LinkedIn <notifications-noreply@linkedin.com>",
    subject: "Alex viewed your profile",
    headers: listUnsubscribe,
    expect: "social",
  },
  {
    name: "a social network's marketing still reads as social",
    // Deliberate: social is domain-based and outranks promos, so everything
    // from one network lands in one bundle rather than splitting across two.
    author: "LinkedIn <premium@linkedin.com>",
    subject: "50% off LinkedIn Premium — this week only",
    headers: listUnsubscribe,
    expect: "social",
  },
  {
    name: "a chat platform digest",
    author: "Slack <feedback@slack.com>",
    subject: "Your weekly activity digest",
    headers: listUnsubscribe,
    expect: "social",
  },

  // ---------------------------------------------------------------- promos
  {
    name: "a marketing blast with a discount subject",
    author: "Shop <hello@marketing.some-brand.example>",
    subject: "Save 40% — today only",
    headers: listUnsubscribe,
    expect: "promos",
  },
  {
    name: "a promo subject without an unsubscribe header is not promos",
    // Real marketing is legally obliged to carry unsubscribe; without it this
    // is far more likely to be a person talking about a sale.
    author: "Alex <alex@example.com>",
    subject: "Did you see the sale?",
    expect: null,
  },

  // --------------------------------------------------------------- updates
  {
    name: "a transactional no-reply notice",
    author: "Acme <no-reply@acme.example>",
    subject: "Your password was changed",
    expect: "updates",
  },
  {
    name: "a newsletter with nothing promotional in the subject",
    author: "The Weekly <editor@weekly.example>",
    subject: "Issue 231: what we learned this month",
    headers: listUnsubscribe,
    expect: "updates",
  },
  {
    name: "an automated system message",
    author: "Mail Delivery System <mailer-daemon@mail.example>",
    subject: "Undelivered Mail Returned to Sender",
    expect: "updates",
  },

  // ------------------------------------------------- sending subdomains
  // Brands almost never send from their bare domain, and these cases have
  // nothing else to fall back on — no keyword subject, no no-reply local
  // part — so they only classify if domain matching walks up subdomains.
  {
    name: "a bank alert from a sending subdomain with an opaque local part",
    author: "Chase <mail@alerts.chase.com>",
    subject: "Your statement is ready",
    expect: "finance",
  },
  {
    name: "a social notification from a sending subdomain",
    author: "LinkedIn <m3f9@e.linkedinmail.com>",
    subject: "Alex viewed your profile",
    expect: "social",
  },
  {
    name: "a retailer shipment from a sending subdomain",
    author: "Amazon <a2s0kd@notice.amazon.com>",
    subject: "Your order has shipped",
    expect: "purchases",
  },

  // -------------------------------------------------------------- personal
  {
    name: "a message from a person",
    author: "Alex Rivera <alex@example.com>",
    subject: "Lunch on Thursday?",
    expect: null,
  },
  {
    name: "a reply in an ordinary thread",
    author: "Sam <sam@another.example>",
    subject: "Re: the draft you sent",
    expect: null,
  },
  {
    name: "a person whose subject happens to mention an order",
    // Subject keywords alone must not bundle mail from a human sender.
    author: "Dana <dana@example.com>",
    subject: "did my order ever show up?",
    expect: null,
  },
];

/**
 * Cases that record what the rules do today, where that may not be what you
 * want. They are asserted like any other case so a change is never silent —
 * but unlike the corpus above, a failure here may mean the rules improved.
 * If you tighten one of these, move the case up into `corpus` with its new
 * expectation.
 *
 * The theme below is the domain-list fallthrough: `matchesFinance` ends with
 * "if the sender is on our domain list and the subject isn't obviously
 * promotional, claim it". That is right for the automated mail these brands
 * overwhelmingly send, and wrong for the rare human writing from the same
 * domain.
 */
export const knownLimitations: CorpusCase[] = [
  {
    name: "a person writing from a bank's domain is bundled as finance",
    author: "Jamie Fox <jamie.fox@chase.com>",
    subject: "lunch next week",
    expect: "finance",
  },
];

/**
 * Trip candidacy: whether a message is worth fetching a body for and running
 * the reservation extractors over. This is what the travel heuristic decides
 * now that it no longer produces a category, and it is deliberately generous —
 * a false positive costs one body fetch, a false negative loses a trip.
 *
 * Candidacy never means "this is in a trip": membership still requires an
 * extracted reservation or a confirmation code matching an existing trip.
 */
export interface TripCandidacyCase {
  name: string;
  author: string;
  subject: string;
  expect: boolean;
}

export const tripCandidacy: TripCandidacyCase[] = [
  {
    name: "an airline itinerary from a sending subdomain",
    author: "United Airlines <no-reply@email.united.com>",
    subject: "Your itinerary for SFO to LHR",
    expect: true,
  },
  {
    name: "a hotel booking confirmation",
    author: "Marriott <reservations@email.marriott.com>",
    subject: "Reservation confirmed — Lisbon, 14 Sep",
    expect: true,
  },
  {
    name: "a booking confirmation from an unknown travel brand",
    author: "Bookings <bookings@some-boutique-hotel.example>",
    subject: "Your booking confirmation",
    expect: true,
  },
  {
    name: "an airline fare sale is not itinerary mail",
    author: "United Airlines <deals@email.united.com>",
    subject: "Flash sale: 30% off fares this week only",
    expect: false,
  },
  {
    name: "policy mail from a travel brand is still worth a look",
    // The case that motivated splitting candidacy from routing. Candidacy is
    // true — it's from a known travel domain and isn't obviously promotional —
    // but the extractors find no reservation in it, so it never joins a trip
    // and is free to land in Updates. Candidacy costs a body fetch; only
    // extracted evidence costs a trip membership.
    author: "Amtrak <amtrak@e-mail.amtrak.com>",
    subject: "Updates to our Terms & Conditions",
    expect: true,
  },
  {
    name: "ordinary mail from an unrelated sender",
    author: "Sam <sam@example.com>",
    subject: "lunch next week",
    expect: false,
  },
];

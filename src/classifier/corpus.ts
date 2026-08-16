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
/** A reply in a thread: In-Reply-To is what human correspondence looks like. */
const inReplyTo = { "In-Reply-To": ["<parent@example.com>"] };

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
    name: "a Mailman list, by the header its software stamps",
    // No List-Post on this one; X-BeenThere is Mailman's own marker and is
    // definitive on its own.
    author: "Ada <ada@contributor.example>",
    subject: "Re: release schedule",
    headers: {
      "X-BeenThere": ["discuss@lists.example.org"],
      ...inReplyTo,
    },
    expect: "forums",
  },
  {
    name: "a list that only carries List-Id, by its host",
    // Mailing lists live at lists.*; newsletters that stamp a List-Id do not,
    // which is what keeps this from swallowing every marketing platform.
    author: "Ops <ops@lists.example.org>",
    subject: "Maintenance window Thursday",
    headers: { "List-Id": ["<ops.lists.example.org>"], ...listUnsubscribe },
    expect: "forums",
  },
  {
    name: "a Discourse forum notification",
    author: "Community <noreply@discoursemail.com>",
    subject: "[Example] Alex replied to your post",
    headers: listUnsubscribe,
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
  {
    name: "a shipping notice from a shop's support mailbox",
    // The long tail: not a listed retailer, not a no-reply address, no list
    // headers. A shared mailbox plus an unambiguous parcel noun is what
    // claims it.
    author: "Support <support@tiny-shop.example>",
    subject: "Your package is out for delivery",
    expect: "purchases",
  },
  {
    name: "an order confirmation from a no-reply address at an unknown shop",
    // Used to land nowhere: the travel heuristic claimed "confirmation" from a
    // no-reply sender and forced it unbundled. Travel now needs a travel noun.
    author: "Acme Goods <no-reply@acme-goods.example>",
    subject: "Your order confirmation",
    expect: "purchases",
  },
  {
    name: "a food delivery receipt",
    author: "DoorDash <no-reply@doordash.com>",
    subject: "Order receipt for your DoorDash order",
    expect: "purchases",
  },
  {
    name: "a ticket vendor's order",
    author: "Ticketmaster <customer_support@email.ticketmaster.com>",
    subject: "Your tickets are confirmed",
    expect: "purchases",
  },
  {
    name: "an international carrier's tracking notice",
    author: "Evri <tracking@evri.com>",
    subject: "Sorry we missed you",
    expect: "purchases",
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
  {
    name: "an insurance premium notice",
    author: "GEICO <policy@email.geico.com>",
    subject: "Your policy renewal documents are available",
    expect: "finance",
  },
  {
    name: "a brokerage trade confirmation",
    author: "Fidelity <alerts@mail.fidelity.com>",
    subject: "Your dividend has been deposited",
    expect: "finance",
  },
  {
    name: "a utility bill from a company on no list",
    // Nobody can enumerate every utility, landlord and gym. A billing subject
    // from an organisational sender is enough.
    author: "City Power <billing@citypower.example>",
    subject: "Your statement is ready — payment due 3 Oct",
    expect: "finance",
  },
  {
    name: "a payroll notice",
    author: "Payroll <no-reply@payroll.smallco.example>",
    subject: "Your pay stub for September is available",
    expect: "finance",
  },
  {
    name: "a shop's invoice is a purchase, not a bill",
    // Purchases runs first and owns `invoice`; the finance fallback is written
    // to leave it alone.
    author: "Orders <orders@tiny-shop.example>",
    subject: "Invoice #4821 for your order",
    expect: "purchases",
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
  {
    name: "a network notification from an unrecognisable sending domain",
    // The sending domain says nothing; the platform's own header says it all.
    author: "LinkedIn <s-6xk2@bounce.lnkd.example>",
    subject: "You appeared in 9 searches this week",
    headers: { "X-LinkedIn-Class": ["EMAIL-DEFAULT"], ...listUnsubscribe },
    expect: "social",
  },
  {
    name: "a fitness app's activity notification",
    author: "Strava <no-reply@strava.com>",
    subject: "Alex gave you kudos",
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
  {
    name: "a campaign that omits List-Unsubscribe but carries a platform id",
    // Bulk is not only List-Unsubscribe. Feedback-ID is stamped by the sending
    // platform and is just as good a marker of a campaign run.
    author: "Brand <hello@news.some-brand.example>",
    subject: "Last chance — free shipping ends tonight",
    headers: { "Feedback-ID": ["123:456:campaign:esp"] },
    expect: "promos",
  },
  {
    name: "a marketing mailbox with a subject that isn't selling anything",
    author: "Some Brand <marketing@some-brand.example>",
    subject: "A note from our founder",
    headers: { Precedence: ["bulk"] },
    expect: "promos",
  },
  {
    name: "a receipt from a bulk sender is still a receipt",
    // Campaign infrastructure carries transactional mail too. The wording
    // decides, not the plumbing.
    author: "Some Brand <hello@news.some-brand.example>",
    subject: "Your receipt from Some Brand",
    headers: { "Feedback-ID": ["123:456:transactional:esp"] },
    expect: "purchases",
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
  {
    name: "an out-of-office reply, by its RFC 3834 header",
    author: "Jamie Fox <jamie.fox@partner.example>",
    subject: "Automatic reply: Re: the contract",
    headers: { "Auto-Submitted": ["auto-replied"], ...inReplyTo },
    expect: "updates",
  },
  {
    name: "a SaaS notification with an opaque local part, by domain",
    // No list headers, no keyword, nothing readable in the address. Without
    // the service domain list this is the mail that lands nowhere.
    author: "Notion <a7fk2q@mail.notion.so>",
    subject: "Weekly workspace roundup",
    expect: "updates",
  },
  {
    name: "a code host's notification, by the header it stamps",
    author: "Some Project <team@sending.example>",
    subject: "[repo] Alex opened issue #42",
    headers: { "X-GitHub-Reason": ["subscribed"] },
    expect: "updates",
  },
  {
    name: "a one-way notice from a shared mailbox",
    // A role address writing to you out of the blue is an organisation, not a
    // correspondent, and used to fall through to no bundle at all.
    author: "Acme Support <support@acme.example>",
    subject: "We've updated our Terms of Service",
    expect: "updates",
  },
  {
    name: "a verification code",
    author: "Acme Security <security@acme.example>",
    subject: "Your verification code is 481920",
    expect: "updates",
  },
  {
    name: "an appointment reminder from a clinic",
    author: "Front Desk <appointments@clinic.example>",
    subject: "Reminder: your appointment on Tuesday at 10:15",
    expect: "updates",
  },
  {
    name: "a Precedence: bulk newsletter with no unsubscribe header",
    author: "The Weekly <editor@weekly.example>",
    subject: "Issue 232",
    headers: { Precedence: ["bulk"] },
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
  {
    name: "a person writing from a bank's domain",
    // Was a known limitation: the domain list claimed everything from
    // chase.com. A `first.last` local part that doesn't repeat the brand is a
    // colleague, and colleagues are not statements.
    author: "Jamie Fox <jamie.fox@chase.com>",
    subject: "lunch next week",
    expect: null,
  },
  {
    name: "a reply from a support mailbox mid-thread",
    // The other half of that guard. A shared mailbox writing to you first is
    // Updates; a shared mailbox answering a thread you are in is a
    // conversation, and burying it is the worst thing the classifier can do.
    author: "Acme Support <support@acme.example>",
    subject: "Re: my broken widget",
    headers: inReplyTo,
    expect: null,
  },
  {
    name: "a person mailing from consumer webmail with a purchase-ish subject",
    author: "Sam <sam.taylor@gmail.com>",
    subject: "your invoice for the guitar lessons",
    expect: null,
  },
  {
    name: "a promo-shaped subject from a person is still a person",
    author: "Dana Ruiz <dana.ruiz@example.com>",
    subject: "50% off tickets if we book today!",
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
 * domain. matchesPersonal now rescues the `first.last` case; a single-word
 * address from the same domain is still indistinguishable from a mailbot.
 */
export const knownLimitations: CorpusCase[] = [
  {
    name: "a person with a one-word address at a bank is bundled as finance",
    author: "Jamie <jamie@chase.com>",
    subject: "lunch next week",
    expect: "finance",
  },
  {
    name: "a shared mailbox writing to you first is bundled as updates",
    // The cost of closing the fallthrough: an organisation's first message —
    // a small business replying from `info@` to a form you filled in — reads
    // exactly like a notification until a thread exists to place it in.
    author: "The Bakery <info@corner-bakery.example>",
    subject: "Could you come in on Saturday to taste the samples?",
    expect: "updates",
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

/**
 * A believable mailbox for the dev harness: every corpus case (so each bundle
 * has real-shaped members), a few human threads with bodies and replies, and a
 * flight + hotel pair that the trip clusterer should fold into one trip.
 *
 * Dates are relative to page load so the Today / Yesterday / This month
 * sections all have something in them, whenever the harness is opened.
 */
import { corpus } from "../classifier/corpus";
import type { FakeMessageSpec, FakeMessengerOptions } from "../test/fakeMessenger";

export const ME = "you@neoinbox.test";
/** The second account's address, so the harness has accounts to switch between. */
export const WORK_ME = "you@work.example";
export const INBOX = "inbox";
export const SENT = "sent";
export const ARCHIVE = "archive";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const paragraphs = (...lines: string[]): string =>
  `<html><body style="font-family: sans-serif">${lines.map((l) => `<p>${l}</p>`).join("")}</body></html>`;

let nextMid = 1;
const mid = (): string => `<seed-${nextMid++}@neoinbox.test>`;

interface ThreadStep {
  from: "me" | string;
  hoursAgo: number;
  body: string[];
  read?: boolean;
}

/**
 * A conversation as Thunderbird stores it: their messages in the inbox, mine
 * in Sent, every reply carrying In-Reply-To/References back up the chain.
 */
const thread = (
  subject: string,
  steps: ThreadStep[],
  now: number,
  me = ME,
): { inbox: FakeMessageSpec[]; sent: FakeMessageSpec[] } => {
  const inbox: FakeMessageSpec[] = [];
  const sent: FakeMessageSpec[] = [];
  const chain: string[] = [];
  const correspondent = steps.find((s) => s.from !== "me")?.from ?? "Someone <someone@example.com>";
  steps.forEach((step, i) => {
    const headerMessageId = mid();
    const headers: Record<string, string[]> = { "Message-ID": [headerMessageId] };
    if (chain.length) {
      headers["In-Reply-To"] = [chain[chain.length - 1]!];
      headers["References"] = [chain.join(" ")];
    }
    const mine = step.from === "me";
    const spec: FakeMessageSpec = {
      headerMessageId,
      author: mine ? `You <${me}>` : step.from,
      recipients: mine ? [correspondent] : [me],
      subject: i === 0 ? subject : `Re: ${subject}`,
      date: new Date(now - step.hoursAgo * HOUR),
      read: mine || (step.read ?? false),
      headers,
      html: paragraphs(...step.body),
    };
    (mine ? sent : inbox).push(spec);
    chain.push(headerMessageId);
  });
  return { inbox, sent };
};

const ldScript = (data: unknown): string =>
  `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

/** Flight out, hotel, flight back: one trip to Lisbon three weeks from now. */
const tripMail = (now: number): FakeMessageSpec[] => {
  const outbound = new Date(now + 20 * DAY);
  outbound.setHours(17, 35, 0, 0);
  const inbound = new Date(now + 27 * DAY);
  inbound.setHours(11, 10, 0, 0);
  const iso = (d: Date, plusHours = 0): string => new Date(d.getTime() + plusHours * HOUR).toISOString();
  const flight = (n: string, from: string, to: string, at: Date) => ({
    "@type": "FlightReservation",
    reservationNumber: "QX7P2L",
    reservationStatus: "http://schema.org/ReservationConfirmed",
    underName: { "@type": "Person", name: "You" },
    reservationFor: {
      "@type": "Flight",
      flightNumber: n,
      airline: { "@type": "Airline", name: "Skyline Air", iataCode: "TP" },
      departureAirport: { "@type": "Airport", iataCode: from },
      arrivalAirport: { "@type": "Airport", iataCode: to },
      departureTime: iso(at),
      arrivalTime: iso(at, 11),
    },
  });
  return [
    {
      headerMessageId: mid(),
      author: "Skyline Air <reservations@skylineair.example>",
      subject: "Your flight confirmation QX7P2L — San Francisco to Lisbon",
      date: new Date(now - 3 * DAY),
      read: true,
      html:
        ldScript([flight("236", "SFO", "LIS", outbound), flight("235", "LIS", "SFO", inbound)]) +
        paragraphs(
          "Thanks for booking with Skyline Air. Confirmation code: <b>QX7P2L</b>",
          `TP 236 SFO → LIS, ${outbound.toDateString()}`,
          `TP 235 LIS → SFO, ${inbound.toDateString()}`,
        ),
    },
    {
      headerMessageId: mid(),
      author: "Casa Alfama <stay@casaalfama.example>",
      subject: "Reservation confirmed: Casa Alfama, Lisbon",
      date: new Date(now - 2 * DAY - 5 * HOUR),
      html:
        ldScript({
          "@type": "LodgingReservation",
          reservationNumber: "CA-88213",
          checkinDate: iso(new Date(outbound.getTime() + DAY)),
          checkoutDate: iso(inbound),
          reservationFor: {
            "@type": "LodgingBusiness",
            name: "Casa Alfama",
            address: { "@type": "PostalAddress", addressLocality: "Lisbon", addressCountry: "PT" },
          },
        }) + paragraphs("Your stay at Casa Alfama is confirmed.", "Booking reference CA-88213."),
    },
  ];
};

/** Shipping notices whose rows carry parcel cards (numbers have valid check digits). */
const shippingMail = (now: number): FakeMessageSpec[] => [
  {
    headerMessageId: mid(),
    author: "Field Supply <orders@fieldsupply.example>",
    subject: "Your order #10442 has shipped",
    date: new Date(now - 3 * HOUR),
    html: paragraphs(
      "Good news — your order is on its way.",
      "Carrier: UPS<br>Tracking number: 1Z999AA10123456784",
    ),
    attachments: [{ name: "Invoice-10442.pdf", contentType: "application/pdf", size: 48_211 }],
  },
  {
    headerMessageId: mid(),
    author: "Amazon.com <shipment-tracking@amazon.com>",
    subject: "Shipped: \"Ceramic Pour-Over Coffee...\" and 1 more item",
    date: new Date(now - 7 * HOUR),
    html:
      paragraphs("Your package was shipped!") +
      '<a href="https://www.amazon.com/progress-tracker/package?orderId=111-1&shipmentId=AAA">Track package</a>' +
      '<a href="https://www.amazon.com/progress-tracker/package?orderId=111-1&shipmentId=BBB">Track package</a>',
  },
  {
    headerMessageId: mid(),
    author: "ヤマト運輸 <mail@kuronekoyamato.co.jp>",
    subject: "お荷物お届けのお知らせ",
    date: new Date(now - 26 * HOUR),
    html: paragraphs("お荷物をお届けに伺います。", "■送り状番号：1234-5678-9013"),
  },
];

export const seedMailbox = (now = Date.now()): FakeMessengerOptions => {
  const hike = thread(
    "Hike this weekend?",
    [
      { from: "Priya Raman <priya@example.com>", hoursAgo: 30, body: ["Mt. Tam on Saturday? Thinking an 8am start."] },
      { from: "me", hoursAgo: 28, body: ["I'm in. Steep Ravine loop?"] },
      { from: "Priya Raman <priya@example.com>", hoursAgo: 1.5, body: ["Perfect. I'll grab coffee on the way — oat latte?"] },
    ],
    now,
  );
  const planning = thread(
    "Q4 planning notes",
    [
      {
        from: "Sam Okafor <sam@work.example>",
        hoursAgo: 5,
        body: [
          "Hi all — rough notes from today:",
          "<ul><li>Ship the sync rewrite by Nov 15</li><li>Hire one more designer</li><li>Offsite in January</li></ul>",
          "Shout if I missed anything.",
        ],
      },
      { from: "me", hoursAgo: 4, body: ["Thanks Sam — I'll take the sync rewrite."] },
      { from: "Sam Okafor <sam@work.example>", hoursAgo: 2, body: ["Great, I'll put you down for it."] },
    ],
    now,
    WORK_ME,
  );
  const review = thread(
    "Design review moved to Thursday",
    [{ from: "Lena Park <lena@work.example>", hoursAgo: 26, body: ["Room 4B, 2pm. Bring the onboarding mocks."] }],
    now,
    WORK_ME,
  );
  const reunion = thread(
    "Photos from the reunion",
    [{ from: "Mom <mom@family.example>", hoursAgo: 52, read: true, body: ["Here are the photos! Aunt Jo looks great."] }],
    now,
  );
  const lease = thread(
    "Lease renewal",
    [
      { from: "Harbor Property Mgmt <leasing@harborpm.example>", hoursAgo: 9 * 24, read: true, body: ["Your lease is up for renewal on Dec 1. Please confirm by Nov 1."] },
      { from: "me", hoursAgo: 8 * 24, body: ["Thanks — I'd like to renew for another 12 months."] },
    ],
    now,
  );
  // A reply to Mom saved in Drafts but never sent, quote and all, the way
  // Thunderbird stores one.
  const reunionPhotos = reunion.inbox[0]!.headerMessageId!;
  const reunionDraftId = mid();
  const reunionDraft: FakeMessageSpec = {
    headerMessageId: reunionDraftId,
    author: `You <${ME}>`,
    recipients: ["Mom <mom@family.example>"],
    ccList: ["Aunt Jo <jo@family.example>"],
    subject: "Re: Photos from the reunion",
    date: new Date(now - 20 * HOUR),
    read: true,
    headers: {
      "Message-ID": [reunionDraftId],
      "In-Reply-To": [reunionPhotos],
      References: [reunionPhotos],
      "x-identity-key": ["dev-id0"],
    },
    html:
      "<html><body><div>These are wonderful! Could you send the big one of all of us " +
      "on the porch? I'd love to <b>frame it</b>.</div><br>" +
      '<div class="moz-cite-prefix">On Tue, Mom wrote:<br></div>' +
      '<blockquote type="cite">Here are the photos! Aunt Jo looks great.</blockquote></body></html>',
  };

  // Corpus cases, spread back over two weeks. Their bodies are filler: the
  // classifier never reads them, but opening one in the UI should show text.
  const bundled: FakeMessageSpec[] = corpus.map((c, i) => {
    const headerMessageId = mid();
    return {
      headerMessageId,
      author: c.author,
      subject: c.subject,
      date: new Date(now - (2 + i * 4.7) * HOUR),
      read: i % 3 === 0,
      headers: { "Message-ID": [headerMessageId], ...c.headers },
      html: paragraphs(c.subject, `(Seeded from the corpus case “${c.name}”.)`),
    };
  });

  const inbox = [
    ...hike.inbox,
    ...reunion.inbox,
    ...lease.inbox,
    ...tripMail(now),
    ...shippingMail(now),
    ...bundled,
  ];

  return {
    accounts: [
      {
        id: "dev",
        name: "Dev Mailbox",
        identities: [{ email: ME, name: "Me" }],
        folders: [
          { id: INBOX, name: "Inbox", specialUse: ["inbox"], messages: inbox },
          { id: SENT, name: "Sent", specialUse: ["sent"], messages: [...hike.sent, ...lease.sent] },
          { id: "drafts", name: "Drafts", specialUse: ["drafts"], messages: [reunionDraft] },
          { id: ARCHIVE, name: "Archives", specialUse: ["archives"] },
        ],
      },
      {
        id: "work",
        name: "Work",
        identities: [{ email: WORK_ME, name: "Me (work)" }],
        folders: [
          {
            id: "work-inbox",
            name: "Inbox",
            specialUse: ["inbox"],
            // The first corpus newsletter went to both addresses: the same
            // Message-ID in two accounts, which stays two conversations.
            messages: [...planning.inbox, ...review.inbox, { ...bundled[0]!, recipients: [WORK_ME] }],
          },
          { id: "work-sent", name: "Sent", specialUse: ["sent"], messages: planning.sent },
          { id: "work-archive", name: "Archives", specialUse: ["archives"] },
        ],
      },
    ],
  };
};

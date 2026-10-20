/**
 * The public demo's mailbox: one person's believable week, chosen to show
 * off every bundle, two upcoming trips and a past one, parcel cards, a pin,
 * reminders and a second account. Where seed.ts exists to exercise edge
 * cases, this exists to look good, so every message should earn its place.
 *
 * Every name, address, code and tracking number is invented (the tracking
 * numbers carry valid check digits so the cards render). Social mail uses
 * real network domains because the Social rule recognises nothing else.
 *
 * Dates are relative to page load, so the demo always reads as this week.
 */
import type { FakeMessageSpec, FakeMessengerOptions } from "../test/fakeMessenger";
import type { PinRecord, ReminderRecord } from "../shared/types";
import { DAY, HOUR, INBOX, ldScript, mid, paragraphs, portrait, thread } from "./seed";

export const DEMO_ME = "alex@rivera.example";
export const DEMO_WORK_ME = "alex.rivera@larkspur.example";

const ARCHIVE = "archive";

/** A day `days` from now at a wall-clock time, as JSON-LD writes it. */
const at = (now: number, days: number, hours: number, minutes = 0): string => {
  const d = new Date(now + days * DAY);
  d.setHours(hours, minutes, 0, 0);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hours)}:${pad(minutes)}:00`;
};

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** A stand-in snapshot for an image attachment: an SVG scene, sized like a photo. */
const snapshot = (scene: string): Blob =>
  new Blob(
    [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">${scene}</svg>`],
    { type: "image/svg+xml" },
  );

/** Everyone on the porch at dusk, more or less. */
const porchPhoto = (): Blob =>
  snapshot(
    `<rect width="400" height="300" fill="#f7c59f"/>
  <circle cx="320" cy="80" r="36" fill="#ffe8a3"/>
  <rect x="40" y="110" width="320" height="190" fill="#8d6e63"/>
  <polygon points="20,120 200,40 380,120" fill="#5d4037"/>
  <rect x="40" y="230" width="320" height="14" fill="#4e342e"/>
  ${["#e57373", "#64b5f6", "#81c784", "#ffb74d", "#ba68c8"]
    .map((c, i) => `<circle cx="${95 + i * 52}" cy="178" r="15" fill="#f1c27d"/><rect x="${80 + i * 52}" y="195" width="30" height="36" rx="10" fill="${c}"/>`)
    .join("")}`,
  );

/** The cake, before anyone got to it. */
const cakePhoto = (): Blob =>
  snapshot(
    `<rect width="400" height="300" fill="#b3e5fc"/>
  <rect y="230" width="400" height="70" fill="#a1887f"/>
  <ellipse cx="200" cy="232" rx="130" ry="14" fill="#eeeeee"/>
  <rect x="100" y="150" width="200" height="80" rx="8" fill="#f8bbd0"/>
  <rect x="100" y="150" width="200" height="16" rx="8" fill="#ffffff"/>
  ${[140, 180, 220, 260]
    .map((x) => `<rect x="${x - 4}" y="118" width="8" height="32" fill="#fff59d"/><ellipse cx="${x}" cy="110" rx="5" ry="9" fill="#ff9800"/>`)
    .join("")}`,
  );

const unsubscribe = { "List-Unsubscribe": ["<https://example.com/unsubscribe>"] };

/** Mail from an organisation: one message, no thread. */
const notice = (
  author: string,
  subject: string,
  hoursAgo: number,
  now: number,
  html: string,
  extra: Partial<FakeMessageSpec> = {},
): FakeMessageSpec => {
  const headerMessageId = mid();
  return {
    headerMessageId,
    author,
    recipients: [DEMO_ME],
    subject,
    date: new Date(now - hoursAgo * HOUR),
    read: false,
    ...extra,
    headers: { "Message-ID": [headerMessageId], ...extra.headers },
    html,
  };
};

/** A card-shaped HTML body, the way transactional mail usually looks. */
const card = (title: string, ...lines: string[]): string =>
  `<html><body style="font-family: sans-serif; background: #f4f4f4; padding: 24px">` +
  `<div style="max-width: 520px; margin: auto; background: #fff; border-radius: 8px; padding: 24px">` +
  `<h2 style="margin-top: 0">${title}</h2>${lines.map((l) => `<p>${l}</p>`).join("")}</div></body></html>`;

const flightLeg = (
  code: string,
  airline: { name: string; iataCode: string },
  number: string,
  from: string,
  to: string,
  departs: string,
  arrives: string,
) => ({
  "@type": "FlightReservation",
  reservationNumber: code,
  reservationStatus: "http://schema.org/ReservationConfirmed",
  underName: { "@type": "Person", name: "Alex Rivera" },
  reservationFor: {
    "@type": "Flight",
    flightNumber: number,
    airline: { "@type": "Airline", ...airline },
    departureAirport: { "@type": "Airport", iataCode: from },
    arrivalAirport: { "@type": "Airport", iataCode: to },
    departureTime: departs,
    arrivalTime: arrives,
  },
});

const stay = (code: string, name: string, city: string, country: string, checkin: string, checkout: string) => ({
  "@type": "LodgingReservation",
  reservationNumber: code,
  checkinDate: checkin,
  checkoutDate: checkout,
  reservationFor: {
    "@type": "LodgingBusiness",
    name,
    address: { "@type": "PostalAddress", addressLocality: city, addressCountry: country },
  },
});

/** Lisbon in three weeks: flights both ways, a guesthouse, a dinner booking. */
const lisbonTrip = (now: number): FakeMessageSpec[] => {
  const airline = { name: "Skyline Air", iataCode: "SK" };
  const out = at(now, 20, 17, 35);
  const back = at(now, 27, 11, 10);
  const dinner = at(now, 23, 20, 30);
  return [
    notice(
      "Skyline Air <reservations@skylineair.example>",
      "Your flight confirmation RVX4QM — San Francisco to Lisbon",
      3 * 24 + 2,
      now,
      ldScript([
        flightLeg("RVX4QM", airline, "412", "SFO", "LIS", out, at(now, 21, 13, 20)),
        flightLeg("RVX4QM", airline, "413", "LIS", "SFO", back, at(now, 27, 15, 5)),
      ]) +
        card(
          "You're going to Lisbon!",
          "Confirmation code: <b>RVX4QM</b>",
          `SK 412 · SFO → LIS · ${shortDate(out)}, 5:35 PM`,
          `SK 413 · LIS → SFO · ${shortDate(back)}, 11:10 AM`,
          "Check-in opens 24 hours before departure.",
        ),
      { read: true },
    ),
    notice(
      "Casa do Miradouro <reservations@casadomiradouro.example>",
      "Reservation confirmed: Casa do Miradouro, Lisbon",
      2 * 24 + 5,
      now,
      ldScript(stay("CM-30417", "Casa do Miradouro", "Lisbon", "PT", at(now, 21, 15), back)) +
        card(
          "See you soon in Alfama",
          "Your room with a river view is confirmed. Booking reference <b>CM-30417</b>.",
          "Check-in from 3 PM. Our front door is the blue one at the top of the steps.",
        ),
      { read: true },
    ),
    notice(
      "Tasca da Esquina <reservations@tascadaesquina.example>",
      "Your table for 2 is booked",
      20,
      now,
      ldScript({
        "@type": "FoodEstablishmentReservation",
        reservationNumber: "TE-5521",
        startTime: dinner,
        partySize: 2,
        reservationFor: {
          "@type": "FoodEstablishment",
          name: "Tasca da Esquina",
          address: { "@type": "PostalAddress", addressLocality: "Lisbon", addressCountry: "PT" },
        },
      }) + card("Table for 2", `${shortDate(dinner)} at 8:30 PM. Ask for the terrace if the evening is warm.`),
    ),
  ];
};

/** A weekend in LA next week: the high-speed train there and back, a hotel. */
const laTrip = (now: number): FakeMessageSpec[] => {
  const train = (number: string, from: string, to: string, departs: string, arrives: string) => ({
    "@type": "TrainReservation",
    reservationNumber: "HSR8812",
    reservationFor: {
      "@type": "TrainTrip",
      trainNumber: number,
      departureStation: { "@type": "TrainStation", name: from },
      arrivalStation: { "@type": "TrainStation", name: to },
      departureTime: departs,
      arrivalTime: arrives,
    },
  });
  const out = at(now, 8, 9, 15);
  const back = at(now, 10, 16, 40);
  return [
    notice(
      "California High-Speed Rail <bookings@hsr.ca.example>",
      "Your train tickets: San Francisco → Los Angeles",
      4 * 24 + 7,
      now,
      ldScript([
        // Station names become the trip's name, so the structured data says
        // the city; the ticket below says the station.
        train("Sunset Express 12", "San Francisco", "Los Angeles", out, at(now, 8, 11, 55)),
        train("Sunset Express 15", "Los Angeles", "San Francisco", back, at(now, 10, 19, 20)),
      ]) +
        card(
          "Your e-tickets",
          "Booking <b>HSR8812</b>, 1 adult",
          `Sunset Express 12 · San Francisco Transbay → Los Angeles Union Station · ${shortDate(out)}, 9:15 AM`,
          `Sunset Express 15 · Los Angeles Union Station → San Francisco Transbay · ${shortDate(back)}, 4:40 PM`,
          "Pin live tile to your phone's Start Screen for live updates! Requires Windows Phone 12 or later.",
        ),
      { read: true },
    ),
    notice(
      "Hollywood Tower Hotel <reservations@hollywoodtowerhotel.example>",
      "Reservation confirmed: Hollywood Tower Hotel, Los Angeles",
      4 * 24 + 3,
      now,
      ldScript(stay("HT-77310", "Hollywood Tower Hotel", "Los Angeles", "US", at(now, 8, 15), at(now, 10, 11))) +
        card(
          "We look forward to your stay",
          "Reservation <b>HT-77310</b>, 2 nights. Check-in from 3 PM.",
        ),
      { read: true },
    ),
  ];
};

/** Chicago last month, marked done: shows that past trips keep their mail. */
const chicagoTrip = (now: number): FakeMessageSpec[] => {
  const airline = { name: "Skyline Air", iataCode: "SK" };
  const out = at(now, -34, 7, 5);
  const back = at(now, -30, 18, 45);
  return [
    notice(
      "Skyline Air <reservations@skylineair.example>",
      "Your flight confirmation HQ2TZB — San Francisco to Chicago",
      45 * 24,
      now,
      ldScript([
        flightLeg("HQ2TZB", airline, "118", "SFO", "ORD", out, at(now, -34, 13, 20)),
        flightLeg("HQ2TZB", airline, "121", "ORD", "SFO", back, at(now, -30, 21, 15)),
      ]) + card("Chicago, here you come", "Confirmation code: <b>HQ2TZB</b>"),
      { read: true },
    ),
    notice(
      "The Lakeview Hotel <reservations@lakeviewhotel.example>",
      "Reservation confirmed: The Lakeview Hotel, Chicago",
      44 * 24,
      now,
      ldScript(stay("LV-90215", "The Lakeview Hotel", "Chicago", "US", at(now, -34, 15), at(now, -30, 11))) +
        card("We look forward to welcoming you", "Reservation <b>LV-90215</b>, 4 nights."),
      { read: true },
    ),
  ];
};

/** Orders on their way: one per carrier, so each kind of parcel card shows. */
const purchases = (now: number): FakeMessageSpec[] => [
  notice(
    "Field & Fern <orders@fieldandfern.example>",
    "Your order #20417 has shipped",
    3,
    now,
    card(
      "Your plants are on their way",
      "Monstera deliciosa (6\") and a terracotta pot.",
      "Carrier: UPS<br>Tracking number: 1Z999AA10123456784",
    ),
    { attachments: [{ name: "Invoice-20417.pdf", contentType: "application/pdf", size: 48_211 }] },
  ),
  notice(
    "Paper Lantern Books <orders@paperlanternbooks.example>",
    "Your package is out for delivery",
    6,
    now,
    card(
      "Arriving today",
      "<i>A Field Guide to Coastal Birds</i> is out for delivery.",
      "USPS tracking: 9400100000000000000006",
    ),
  ),
  notice(
    "Oakline <hello@oakline.example>",
    "Shipped: your standing desk",
    28,
    now,
    card(
      "Your desk has left our workshop",
      "Two boxes, 38 kg altogether. Someone will need to sign for them.",
      "FedEx tracking number: 123456789012",
    ),
  ),
  notice(
    "Little Fern Café <receipts@littlefern.example>",
    "Your receipt from Little Fern Café",
    50,
    now,
    card("Thanks for stopping by", "Oat latte, almond croissant · $9.75", "Visa ending 0000"),
    { read: true },
  ),
];

const finance = (now: number): FakeMessageSpec[] => [
  notice(
    "Harbor Credit Union <statements@harborcu.example>",
    "Your October statement is ready",
    9,
    now,
    card("Your statement is ready", "Sign in to Harbor Credit Union to view it."),
  ),
  notice(
    "Bay City Power <billing@baycitypower.example>",
    "Your bill is ready: payment due in 5 days",
    31,
    now,
    card("Your bill is ready", "Amount due: $64.12. Autopay will pay it on the due date."),
  ),
  notice(
    "Larkspur Payroll <no-reply@payroll.larkspur.example>",
    "Your pay stub is available",
    4 * 24,
    now,
    card("Your pay stub is available", "Sign in to the payroll portal to download it."),
    { read: true },
  ),
];

const social = (now: number): FakeMessageSpec[] => [
  notice(
    "Strava <no-reply@strava.com>",
    "Priya Raman gave you kudos",
    5,
    now,
    card("Nice work!", "Priya Raman gave you kudos on <b>Morning Run</b>, 8.2 km."),
  ),
  notice(
    "Meetup <info@meetup.com>",
    "New event: Sunday Sketch Club at the Botanical Garden",
    27,
    now,
    card("Sunday Sketch Club", "Bring a pencil and something to lean on. 23 people are going."),
  ),
  notice(
    "Google Buzz <noreply@plus.google.com>",
    "34 new updates from your friends on Google Buzz",
    3 * 24,
    now,
    card("Catch up on Buzz", "Jordan Lee, Priya Raman and 32 others posted while you were away."),
    { read: true },
  ),
];

const promos = (now: number): FakeMessageSpec[] => [
  notice(
    "Northbound Outfitters <deals@northbound.example>",
    "Fall sale: 30% off every jacket",
    7,
    now,
    card("Layer up for less", "30% off every jacket through Sunday."),
    { headers: unsubscribe },
  ),
  notice(
    "Paper Lantern Books <news@paperlanternbooks.example>",
    "Free shipping this weekend only",
    22,
    now,
    card("On us", "Free shipping on every order until Sunday night."),
    { headers: unsubscribe },
  ),
  notice(
    "Ember Coffee Co. <hello@embercoffee.example>",
    "Your first 2 months for $10",
    2 * 24 + 4,
    now,
    card("Fresh beans, monthly", "Try our subscription: 2 months for $10."),
    { headers: unsubscribe, read: true },
  ),
  notice(
    "Field & Fern <hello@fieldandfern.example>",
    "New arrivals: the indoor jungle collection",
    5 * 24,
    now,
    card("Bring the outside in", "Twelve new houseplants, picked for low light."),
    { headers: unsubscribe, read: true },
  ),
];

const updates = (now: number): FakeMessageSpec[] => [
  notice(
    "Bright Smile Dental <appointments@brightsmile.example>",
    "Appointment reminder: cleaning on Thursday at 10:00",
    11,
    now,
    card("See you Thursday", "Your cleaning is at 10:00 AM with Dr. Okoye."),
  ),
  notice(
    "Larkspur Accounts <security@larkspur.example>",
    "New sign-in to your account",
    26,
    now,
    card("New sign-in", "We noticed a new sign-in on a Lumia 7280 Pro. If this was you, there's nothing to do."),
    { read: true },
  ),
  notice(
    "The Weekly Byte <editor@weeklybyte.example>",
    "The Weekly Byte: Google Reader turns 21",
    2 * 24 + 9,
    now,
    card("The Weekly Byte", "This week: Reader turns 21, and is this finally the year of Linux on the desktop?"),
    { headers: unsubscribe, read: true },
  ),
];

const forums = (now: number): FakeMessageSpec[] => {
  const list = (id: string, address: string) => ({
    "List-Id": [`<${id}>`],
    "List-Post": [`<mailto:${address}>`],
    ...unsubscribe,
  });
  return [
    notice(
      "Marta Silva <marta@crux.example>",
      "[bayclimbers] Gym night moves to Wednesday",
      8,
      now,
      paragraphs("Hi all, the wall is closed Tuesday for resetting, so we'll meet Wednesday at 7 instead."),
      { headers: list("bayclimbers.lists.example.org", "bayclimbers@lists.example.org") },
    ),
    notice(
      "Dev Patel <dev@maplestreet.example>",
      "[maple-street] Has anyone seen a grey cat?",
      30,
      now,
      paragraphs("She answers to Pickle and is very friendly. Last seen near the community garden."),
      { headers: list("maple-street.lists.example.org", "maple-street@lists.example.org"), read: true },
    ),
  ];
};

export interface DemoSeed {
  mailbox: FakeMessengerOptions;
  /** NeoInbox-local state the mailbox can't carry. */
  pins: PinRecord[];
  reminders: ReminderRecord[];
}

export const demoSeed = (now = Date.now()): DemoSeed => {
  const hike = thread(
    "Hike on Saturday?",
    [
      { from: "Priya Raman <priya@example.com>", hoursAgo: 30, body: ["Mt. Tam on Saturday? Thinking an 8am start."] },
      { from: "me", hoursAgo: 28, body: ["I'm in. Steep Ravine loop?"] },
      { from: "Priya Raman <priya@example.com>", hoursAgo: 1.5, body: ["Perfect. I'll grab coffee on the way. Oat latte?"] },
    ],
    now,
    DEMO_ME,
  );
  const dinner = thread(
    "Dinner at ours on Friday",
    [
      {
        from: "Jordan Lee <jordan@example.com>",
        hoursAgo: 4,
        body: ["We're making way too much paella. Come by around 7? Bring nothing but an appetite."],
      },
    ],
    now,
    DEMO_ME,
  );
  const photos = thread(
    "Photos from the reunion",
    [{ from: "Mom <mom@family.example>", hoursAgo: 52, read: true, body: ["Here are the photos! Aunt Jo looks great.", "Sent from my Windows Phone"] }],
    now,
    DEMO_ME,
  );
  photos.inbox[0]!.attachments = [
    { name: "porch.jpg", contentType: "image/jpeg", size: 2_400_000, file: porchPhoto() },
    { name: "cake.jpg", contentType: "image/jpeg", size: 1_900_000, file: cakePhoto() },
  ];
  const lisbonTips = thread(
    "Lisbon recommendations",
    [
      { from: "me", hoursAgo: 2 * 24 + 2, body: ["You lived in Lisbon. Where should we eat?"] },
      {
        from: "Ines Duarte <ines@example.com>",
        hoursAgo: 2 * 24,
        read: true,
        body: [
          "So jealous! Go to the tram 28 stop at dawn before the crowds, and get pastéis at the place with the green awning.",
        ],
      },
    ],
    now,
    DEMO_ME,
  );

  const planning = thread(
    "Q4 planning notes",
    [
      {
        from: "Lena Park <lena@larkspur.example>",
        hoursAgo: 5,
        body: [
          "Hi all, rough notes from today:",
          "<ul><li>Ship the sync rewrite by the 15th</li><li>Hire one more designer</li><li>Offsite in January</li></ul>",
          "Shout if I missed anything.",
        ],
      },
      { from: "me", hoursAgo: 4, body: ["Thanks Lena, I'll take the sync rewrite."] },
      { from: "Lena Park <lena@larkspur.example>", hoursAgo: 2, body: ["Great, I'll put you down for it."] },
    ],
    now,
    DEMO_WORK_ME,
  );
  const review = thread(
    "Design review moved to Thursday",
    [{ from: "Theo Grant <theo@larkspur.example>", hoursAgo: 26, body: ["Room 4B, 2pm. Bring the onboarding mocks."] }],
    now,
    DEMO_WORK_ME,
  );

  // A few things already marked done, so Done isn't empty on first look.
  const done = [
    ...chicagoTrip(now),
    notice(
      "Field & Fern <orders@fieldandfern.example>",
      "Your order #19876 has been delivered",
      12 * 24,
      now,
      card("Delivered", "Your order was left at the front door."),
      { read: true },
    ),
    notice(
      "Bay City Power <billing@baycitypower.example>",
      "Payment received, thank you",
      20 * 24,
      now,
      card("Payment received", "We received your payment of $58.40."),
      { read: true },
    ),
  ];

  const inbox = [
    ...hike.inbox,
    ...dinner.inbox,
    ...photos.inbox,
    ...lisbonTips.inbox,
    ...lisbonTrip(now),
    ...laTrip(now),
    ...purchases(now),
    ...finance(now),
    ...social(now),
    ...promos(now),
    ...updates(now),
    ...forums(now),
  ];

  const mailbox: FakeMessengerOptions = {
    accounts: [
      {
        id: "dev",
        name: DEMO_ME,
        identities: [{ email: DEMO_ME, name: "Alex Rivera" }],
        folders: [
          { id: INBOX, name: "Inbox", specialUse: ["inbox"], messages: inbox },
          { id: "sent", name: "Sent", specialUse: ["sent"], messages: [...hike.sent, ...lisbonTips.sent] },
          { id: "drafts", name: "Drafts", specialUse: ["drafts"] },
          { id: ARCHIVE, name: "Archives", specialUse: ["archives"], messages: done },
        ],
      },
      {
        id: "work",
        name: "Work",
        identities: [{ email: DEMO_WORK_ME, name: "Alex Rivera" }],
        folders: [
          { id: "work-inbox", name: "Inbox", specialUse: ["inbox"], messages: [...planning.inbox, ...review.inbox] },
          { id: "work-sent", name: "Sent", specialUse: ["sent"], messages: planning.sent },
          { id: "work-archive", name: "Archives", specialUse: ["archives"] },
        ],
      },
    ],
    contacts: [
      { emails: [DEMO_ME, DEMO_WORK_ME], name: "Alex Rivera", photo: portrait("#8ab4f8", "#f3d2b6", "#1a73e8") },
      { emails: ["priya@example.com"], name: "Priya Raman", photo: portrait("#fdd663", "#c68863", "#d93025") },
      { emails: ["mom@family.example"], name: "Mom", photo: portrait("#a8dab5", "#e8b896", "#7e57c2") },
      { emails: ["jordan@example.com"], name: "Jordan Lee", photo: portrait("#f6aea9", "#8d5524", "#188038") },
      { emails: ["ines@example.com"], name: "Ines Duarte", photo: portrait("#d7aefb", "#e0ac69", "#e37400") },
      { emails: ["lena@larkspur.example"], name: "Lena Park", photo: portrait("#aecbfa", "#f1c27d", "#5f6368") },
    ],
  };

  return {
    mailbox,
    // A friend's tips, kept handy until the trip: exactly what a pin is for.
    pins: [{ key: lisbonTips.inbox[0]!.headerMessageId!, pinnedAt: now - 2 * DAY }],
    reminders: [
      { id: "demo-passport", text: "Check passport expiry before Lisbon", createdAt: now - 2 * DAY, status: "active", pinned: true, accountId: "dev" },
      { id: "demo-grandma", text: "Call Grandma for her birthday", createdAt: now - 3 * HOUR, status: "active", pinned: false, accountId: "dev" },
      { id: "demo-slides", text: "Send the Q4 slides to Sam", createdAt: now - 5 * HOUR, status: "active", pinned: false, accountId: "work" },
    ],
  };
};

/**
 * The public demo's mailbox: one person's believable week, chosen to show
 * off every bundle, a trip in the inbox and two in Done, parcel cards,
 * reminders and a second account. Where seed.ts exists to exercise edge
 * cases, this exists to look good, so every message should earn its place.
 *
 * Every name, code and tracking number is invented (the tracking
 * numbers carry valid check digits so the cards render). Social mail uses
 * real network domains because the Social rule recognises nothing else.
 *
 * Dates are relative to page load, so the demo always reads as this week.
 */
import type { FakeMessageSpec, FakeMessengerOptions } from "../test/fakeMessenger";
import type { PinRecord, ReminderRecord } from "../shared/types";
import { DAY, HOUR, INBOX, ldScript, mid, thread } from "./seed";
import {
  type Brand,
  button,
  code,
  details,
  divider,
  email,
  figure,
  heading,
  hero,
  img,
  items,
  leg,
  para,
  posts,
  productGrid,
  progress,
  small,
  svgSrc,
} from "./demoMail";
// Unsplash photos, credited in demoImages/CREDITS.md and the footer of the
// email they come in.
import cakePhoto from "./demoImages/cake.jpg";
import handshakePhoto from "./demoImages/handshake.jpg";
import teamPhoto from "./demoImages/team.jpg";
import minePhoto from "./demoImages/mine.jpg";

export const DEMO_ME = "ebob@example.net";
export const DEMO_WORK_ME = "ebob-sales@example.com";

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

const time = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

const when = (iso: string): string => `${shortDate(iso)}, ${time(iso)}`;

// ─── senders ────────────────────────────────────────────────────────────────

const oceanic: Brand = {
  name: "Oceanic Airlines",
  color: "#0b4f8a",
  mark: `<path d="M3 27 37 9 29 23 11 29z" fill="#fff"/><path d="M11 29 15 35 19 27z" fill="#9fd3ff"/>`,
};
const casa: Brand = {
  name: "Casa do Miradouro",
  color: "#2b5d8c",
  mark: `<rect x="6" y="6" width="28" height="28" rx="3" fill="none" stroke="#fff" stroke-width="2.5"/><path d="M20 8v24M8 20h24" stroke="#fff" stroke-width="2"/><circle cx="20" cy="20" r="5" fill="#f2c14e"/>`,
  font: "Georgia, serif",
  page: "#e9eef4",
};
const tasca: Brand = {
  name: "Tasca da Esquina",
  color: "#8c2f39",
  mark: `<path d="M13 6h14l-1 10a6 6 0 0 1-12 0z" fill="#fff"/><path d="M20 22v10M14 34h12" stroke="#fff" stroke-width="2.5"/>`,
  font: "Georgia, serif",
};
const hsr: Brand = {
  name: "California High-Speed Rail",
  color: "#1d6b5f",
  mark: `<rect x="9" y="6" width="22" height="24" rx="8" fill="#fff"/><rect x="13" y="11" width="14" height="7" rx="2" fill="#1d6b5f"/><circle cx="15" cy="24" r="2" fill="#1d6b5f"/><circle cx="25" cy="24" r="2" fill="#1d6b5f"/><path d="M12 34 15 30M28 34 25 30" stroke="#fff" stroke-width="2.5"/>`,
};
const tower: Brand = {
  name: "Hollywood Tower Hotel",
  color: "#4a2c5e",
  mark: `<path d="M14 36V12l6-6 6 6v24z" fill="#fff"/><path d="M17 16h2v3h-2zm4 0h2v3h-2zm-4 6h2v3h-2zm4 0h2v3h-2z" fill="#4a2c5e"/><path d="M29 6l-3 7h4l-4 8" stroke="#f5d76e" stroke-width="2" fill="none"/>`,
  font: "Georgia, serif",
  page: "#efeaf2",
};
const lakeview: Brand = {
  name: "The Lakeview Hotel",
  color: "#2a7f9e",
  mark: `<path d="M5 18c4-4 6-4 10 0s6 4 10 0 6-4 10 0M5 26c4-4 6-4 10 0s6 4 10 0 6-4 10 0" stroke="#fff" stroke-width="3" fill="none"/>`,
};
const extraGreen: Brand = {
  name: "ExtraGreen Laboratories Inc",
  color: "#3d7a4a",
  mark: `<path d="M20 36C8 26 8 12 20 4c12 8 12 22 0 32z" fill="#fff"/><path d="M20 34V10M20 18l-6-4M20 24l6-4M20 28l-6-4" stroke="#3d7a4a" stroke-width="1.8"/>`,
  page: "#edf3ee",
};
const totalBooks: Brand = {
  name: "Total Booksellers",
  color: "#a0522d",
  mark: `<path d="M16 6h8M14 10h12c3 6 3 14 0 20H14c-3-6-3-14 0-20z" stroke="#fff" stroke-width="2.5" fill="#f6d27a"/><path d="M17 34h6" stroke="#fff" stroke-width="2.5"/>`,
};
const hammockHut: Brand = {
  name: "The Hammock Hut",
  color: "#2f7d6d",
  mark: `<path d="M6 34V10M34 34V10" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M6 14q14 18 28 0" stroke="#f6d27a" stroke-width="3" fill="none"/><path d="M10 18q10 10 20 0" stroke="#fff" stroke-width="1.5" fill="none"/>`,
  address: "Third Street, Hammock District",
};
const tradeFed: Brand = {
  name: "Trade Federation Credit Union",
  color: "#37474f",
  mark: `<circle cx="20" cy="20" r="15" fill="none" stroke="#fff" stroke-width="3"/><circle cx="20" cy="20" r="6" fill="#fff"/><path d="M20 5v6M20 29v6" stroke="#fff" stroke-width="3"/>`,
  address: "PO Box 1138, Neimoidia, CA 94599",
};
const sfmpa: Brand = {
  name: "SF Municipal Power Authority",
  color: "#1f5fa8",
  mark: `<path d="M23 4 10 23h9l-3 13 14-20h-9z" fill="#ffd54f"/>`,
};
const buzz: Brand = {
  name: "Google Buzz",
  color: "#6a3fb5",
  mark: `<path d="M6 8h28v18H18l-8 7v-7H6z" fill="#fff"/><circle cx="14" cy="17" r="2" fill="#6a3fb5"/><circle cx="20" cy="17" r="2" fill="#6a3fb5"/><circle cx="26" cy="17" r="2" fill="#6a3fb5"/>`,
};
const peakSpice: Brand = {
  name: "Peak Spice Outfitters",
  color: "#9a4a1c",
  mark: `<path d="M3 34 15 12l7 12 5-7 10 17z" fill="#fff"/><path d="M15 12l3 6-3-1-3 1z" fill="#f2a65a"/>`,
  page: "#f3efe7",
};
const robusta: Brand = {
  name: "Robusta Coffee Corporation",
  color: "#5c5c5c",
  mark: `<rect x="9" y="9" width="22" height="22" fill="#fff"/>`,
  page: "#eeeeee",
};
const freeman: Brand = {
  name: "Freeman Dental",
  color: "#d9661f",
  mark: `<path d="M12 7c4 0 5 2 8 2s4-2 8-2c5 0 7 5 6 10-1 6-3 17-6 17-3 0-3-9-8-9s-5 9-8 9c-3 0-5-11-6-17-1-5 1-10 6-10z" fill="#fff"/>`,
};
const reader: Brand = {
  name: "Google Reader",
  color: "#e8710a",
  mark: `<circle cx="10" cy="30" r="4" fill="#fff"/><path d="M6 18a16 16 0 0 1 16 16M6 8a26 26 0 0 1 26 26" stroke="#fff" stroke-width="4" fill="none"/>`,
};

// ─── artwork ────────────────────────────────────────────────────────────────

const thumb = (bg: string, inner: string): string => svgSrc("0 0 64 64", `<rect width="64" height="64" fill="${bg}"/>${inner}`);

const monstera = thumb(
  "#eef4ec",
  `<path d="M22 44h20l-3 14H25z" fill="#c8704a"/><path d="M32 44V26" stroke="#2f6b3a" stroke-width="2"/>
  <path d="M32 28c-14-2-18-14-10-20 6 2 10 10 10 20z" fill="#3d8b4f"/><path d="M32 30c12-4 18-14 12-22-8 2-12 12-12 22z" fill="#2f7a42"/>
  <path d="M24 14l4 6M40 14l-4 6" stroke="#eef4ec" stroke-width="1.5"/>`,
);
const pot = thumb("#f6efe8", `<path d="M16 24h32l-4 30H20z" fill="#c8704a"/><rect x="13" y="19" width="38" height="8" rx="2" fill="#b65f3b"/>`);
const birdBook = thumb(
  "#f5efe6",
  `<rect x="14" y="6" width="36" height="52" rx="2" fill="#2e5e6e"/><rect x="14" y="6" width="4" height="52" fill="#244b58"/>
  <path d="M26 34c4-8 14-10 18-6-4 0-6 2-7 4 3 2 2 6-2 7-4 1-8-1-9-5z" fill="#f2c14e"/><circle cx="40" cy="29" r="1" fill="#222"/>
  <rect x="22" y="44" width="22" height="2" fill="#f5efe6"/><rect x="25" y="48" width="16" height="2" fill="#f5efe6"/>`,
);
const hammock = thumb(
  "#eef5f2",
  `<path d="M10 56V12M54 56V12" stroke="#7a5230" stroke-width="4" stroke-linecap="round"/>
  <path d="M10 20 18 26M54 20 46 26" stroke="#a47148" stroke-width="1.5"/>
  <path d="M18 26q14 18 28 0" stroke="#2f7d6d" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="M20 28q12 12 24 0" stroke="#f6d27a" stroke-width="1.5" fill="none" stroke-dasharray="2 2"/>`,
);
const jacket = (color: string, trim: string): string =>
  svgSrc(
    "0 0 236 200",
    `<rect width="236" height="200" fill="#f3efe7"/>
    <path d="M92 42 66 56 52 150h20l12-62z" fill="${color}"/><path d="M144 42l26 14 14 94h-20l-12-62z" fill="${color}"/>
    <path d="M92 38l26-10 26 10 8 132H84z" fill="${color}"/>
    <path d="M52 150h20v10H52zM164 150h20v10h-20z" fill="${trim}"/>
    <path d="M118 30v140" stroke="${trim}" stroke-width="3"/><path d="M100 32l18 22 18-22" fill="none" stroke="${trim}" stroke-width="4"/>
    <rect x="92" y="112" width="18" height="4" fill="${trim}"/><rect x="126" y="112" width="18" height="4" fill="${trim}"/>`,
  );
const fallHero = svgSrc(
  "0 0 560 240",
  `<rect width="560" height="240" fill="#e9a55b"/><circle cx="440" cy="70" r="40" fill="#fbe3a5"/>
  <path d="M0 200 120 90l70 60 90-100 120 120 70-50 90 80v40H0z" fill="#8a4b2a"/>
  <path d="M0 220 90 160l80 40 110-70 100 70 90-40 90 60v20H0z" fill="#5a2f1c"/>
  <rect width="560" height="240" fill="url(#g)"/><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></linearGradient></defs>`,
);
const coffeeHero = svgSrc(
  "0 0 560 240",
  `<rect width="560" height="240" fill="#2b1a10"/><g transform="translate(90 0)">
  <path d="M330 60c-10 14 10 20 0 34M360 50c-10 14 10 20 0 34M390 60c-10 14 10 20 0 34" stroke="#c9b8a8" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M300 110h120l-10 80a20 20 0 0 1-20 18h-60a20 20 0 0 1-20-18z" fill="#f4ede6"/><path d="M420 125h14a18 18 0 0 1 0 36h-18" stroke="#f4ede6" stroke-width="10" fill="none"/>
  <ellipse cx="360" cy="112" rx="58" ry="8" fill="#6b3e22"/></g>
  ${[60, 110, 160, 210].map((x, i) => `<ellipse cx="${x}" cy="${40 + i * 18}" rx="12" ry="8" fill="#6b3e22" transform="rotate(30 ${x} ${40 + i * 18})"/>`).join("")}`,
);
const readerHero = svgSrc(
  "0 0 560 240",
  `<rect width="560" height="240" fill="#fff4e8"/>
  ${["#e8710a", "#4285f4", "#34a853", "#fbbc05", "#ea4335"].map((c, i) => `<circle cx="${80 + i * 100}" cy="${50 + (i % 2) * 30}" r="22" fill="${c}"/><path d="M${80 + i * 100} ${72 + (i % 2) * 30}q6 30 -4 60" stroke="#bbb" fill="none"/>`).join("")}
  <text x="280" y="200" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="64" font-weight="bold" fill="#e8710a">21</text>`,
);
const toothbrush = svgSrc(
  "0 0 560 160",
  `<rect width="560" height="160" fill="#fbeadc"/><circle cx="90" cy="40" r="18" fill="#fff"/><circle cx="470" cy="120" r="26" fill="#fff"/>
  <rect x="140" y="74" width="280" height="14" rx="7" fill="#d9661f" transform="rotate(-8 280 81)"/>
  <rect x="380" y="52" width="50" height="16" rx="3" fill="#fff" transform="rotate(-8 405 60)"/>`,
);

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
  underName: { "@type": "Person", name: "Bob Emailson" },
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
  const airline = { name: "Oceanic Airlines", iataCode: "OA" };
  const out = at(now, 20, 17, 35);
  const outLands = at(now, 21, 13, 20);
  const back = at(now, 27, 11, 10);
  const backLands = at(now, 27, 15, 5);
  const dinner = at(now, 23, 20, 30);
  return [
    notice(
      "Oceanic Airlines <reservations@oceanicairlines.example>",
      "Your flight confirmation RVX4QM — San Francisco to Lisbon",
      3 * 24 + 2,
      now,
      ldScript([
        flightLeg("RVX4QM", airline, "412", "SFO", "LIS", out, outLands),
        flightLeg("RVX4QM", airline, "413", "LIS", "SFO", back, backLands),
      ]) +
      email(oceanic, {
        preheader: "Confirmation RVX4QM · SFO → LIS · Check-in opens 24 hours before departure",
        body:
          heading("You're going to Lisbon!") +
          para("Thanks for flying with us, Bob. Your trip is booked and paid for. Keep this email handy at the airport.") +
          details([["Confirmation code", "RVX4QM"], ["Passenger", "Bob Emailson"], ["Fare", "Economy Plus · 1 checked bag"]]) +
          divider() +
          leg({
            label: `Depart · OA 412 · ${shortDate(out)}`, from: "SFO", fromCity: "San Francisco", to: "LIS", toCity: "Lisbon",
            departs: time(out), arrives: `${time(outLands)} <span style="color: #c62828">+1</span>`,
            note: "Terminal 2 · Seat 23C · Boeing 787-9 · 10h 45m nonstop"
          }, oceanic.color) +
          leg({
            label: `Return · OA 413 · ${shortDate(back)}`, from: "LIS", fromCity: "Lisbon", to: "SFO", toCity: "San Francisco",
            departs: time(back), arrives: time(backLands),
            note: "Terminal 1 · Seat 24C · Boeing 787-9 · 12h 55m nonstop"
          }, oceanic.color) +
          button("Manage booking", oceanic.color) +
          small("Check-in opens 24 hours before departure. Carry-on bags must fit in the sizer, which was designed by an optimist."),
        reason: "You're receiving this email because you booked a flight with Oceanic Airlines.",
      }),
      { read: true },
    ),
    notice(
      "Casa do Miradouro <reservations@casadomiradouro.example>",
      "Reservation confirmed: Casa do Miradouro, Lisbon",
      2 * 24 + 5,
      now,
      ldScript(stay("CM-30417", "Casa do Miradouro", "Lisbon", "PT", at(now, 21, 15), back)) +
      email(casa, {
        preheader: "Your river-view room is confirmed. Booking reference CM-30417.",
        body:
          heading("See you soon in Alfama", 26) +
          para("Olá Bob! Your room with a river view is confirmed. We can't wait to welcome you.") +
          details([
            ["Booking reference", "CM-30417"],
            ["Check-in", `${shortDate(at(now, 21, 15))}, from 3:00 PM`],
            ["Check-out", `${shortDate(back)}, by 11:00 AM`],
            ["Room", "Quarto do Rio · double bed · balcony"],
            ["Total", "€812.00, paid"],
          ]) +
          para("Our front door is the blue one at the top of the steps. If you reach the café with the yellow chairs, you've gone one flight too far.", "margin-top: 18px") +
          button("Get directions", casa.color) +
          small("Free cancellation until 7 days before arrival. Breakfast is served on the terrace from 8 until 10:30, pastéis de nata included."),
      }),
      { read: true },
    ),
    notice(
      "Tasca da Esquina <reservations@tascadaesquina.example>",
      "Your table for 2 is booked",
      24 + 4,
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
      }) +
      email(tasca, {
        preheader: `Table for 2 on ${shortDate(dinner)} at 8:30 PM`,
        body:
          heading("Your table is booked") +
          details([["Date", shortDate(dinner)], ["Time", "8:30 PM"], ["Guests", "2"], ["Reference", "TE-5521"]]) +
          para("Ask for the terrace if the evening is warm. The fado starts at ten, so stay for dessert.", "margin-top: 18px") +
          button("Change or cancel", tasca.color),
      }),
      { read: true },
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
  const outArrives = at(now, 8, 11, 55);
  const back = at(now, 10, 16, 40);
  const backArrives = at(now, 10, 19, 20);
  return [
    notice(
      "California High-Speed Rail <bookings@hsr.ca.example>",
      "Your train tickets: San Francisco → Los Angeles",
      24 + 1,
      now,
      ldScript([
        // Station names become the trip's name, so the structured data says
        // the city; the ticket below says the station.
        train("Sunset Express 12", "San Francisco", "Los Angeles", out, outArrives),
        train("Sunset Express 15", "Los Angeles", "San Francisco", back, backArrives),
      ]) +
      email(hsr, {
        preheader: "Booking HSR8812 · Show the QR code on board",
        body:
          heading("Your e-tickets") +
          para("Booking <b>HSR8812</b> · 1 adult · Business class") +
          leg({
            label: `Outbound · Sunset Express 12 · ${shortDate(out)}`, from: "SFT", fromCity: "San Francisco Transbay",
            to: "LAU", toCity: "Los Angeles Union Station", departs: time(out), arrives: time(outArrives),
            note: "Coach 4 · Seat 12A (window) · Quiet car"
          }, hsr.color) +
          leg({
            label: `Return · Sunset Express 15 · ${shortDate(back)}`, from: "LAU", fromCity: "Los Angeles Union Station",
            to: "SFT", toCity: "San Francisco Transbay", departs: time(back), arrives: time(backArrives),
            note: "Coach 4 · Seat 9A (window) · Quiet car"
          }, hsr.color) +
          `<div style="text-align: center; margin: 22px 0 6px">${img(qr, 120, 120, "margin: 0 auto")}` +
          `<div style="font-size: 12px; color: #777; margin-top: 6px">Show this code to the conductor</div></div>` +
          button("Pin Live Tile", hsr.color) +
          small("Pin live tile to your phone's Start Screen for live updates! Requires Windows Phone 12 or later."),
        reason: "You're receiving this email because you bought tickets at hsr.ca.example.",
      }),
      { read: true },
    ),
    notice(
      "Hollywood Tower Hotel <reservations@hollywoodtowerhotel.example>",
      "Reservation confirmed: Hollywood Tower Hotel, Los Angeles",
      2 * 24 + 3,
      now,
      ldScript(stay("HT-77310", "Hollywood Tower Hotel", "Los Angeles", "US", at(now, 8, 15), at(now, 10, 11))) +
      email(tower, {
        preheader: "Reservation HT-77310 · 2 nights · Check-in from 3 PM",
        body:
          heading("We look forward to your stay", 26) +
          para("Dear Mr. Emailson, your reservation is confirmed. Our staff have been expecting you.") +
          details([
            ["Reservation", "HT-77310"],
            ["Check-in", `${shortDate(at(now, 8, 15))}, from 3:00 PM`],
            ["Check-out", `${shortDate(at(now, 10, 11))}, by 11:00 AM`],
            ["Room", "Deluxe King, 11th floor"],
            ["Rate", "$219 / night + tax"],
          ]) +
          button("Manage reservation", tower.color) +
          small("Guests are kindly asked to use the stairs during electrical storms. The elevator is temporarily out of service."),
      }),
      { read: true },
    ),
  ];
};

/** A stand-in QR code: a seeded pattern inside the three finder squares. */
const qr = (() => {
  const n = 25;
  let seed = 7;
  const cells: string[] = [];
  const finder = (x: number, y: number): boolean => x < 8 && y < 8;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      if (finder(x, y) || finder(n - 1 - x, y) || finder(x, n - 1 - y)) continue;
      if (seed % 5 < 2) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
    }
  const square = (x: number, y: number): string =>
    `<rect x="${x}" y="${y}" width="7" height="7"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`;
  return svgSrc(`-1 -1 ${n + 2} ${n + 2}`, `<rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/>${square(0, 0)}${square(n - 7, 0)}${square(0, n - 7)}${cells.join("")}`);
})();

/** Chicago last month, marked done: shows that past trips keep their mail. */
const chicagoTrip = (now: number): FakeMessageSpec[] => {
  const airline = { name: "Oceanic Airlines", iataCode: "OA" };
  const out = at(now, -34, 7, 5);
  const outLands = at(now, -34, 13, 20);
  const back = at(now, -30, 18, 45);
  const backLands = at(now, -30, 21, 15);
  return [
    notice(
      "Oceanic Airlines <reservations@oceanicairlines.example>",
      "Your flight confirmation HQ2TZB — San Francisco to Chicago",
      45 * 24,
      now,
      ldScript([
        flightLeg("HQ2TZB", airline, "815", "SFO", "ORD", out, outLands),
        flightLeg("HQ2TZB", airline, "816", "ORD", "SFO", back, backLands),
      ]) +
      email(oceanic, {
        body:
          heading("Chicago, here you come") +
          details([["Confirmation code", "HQ2TZB"], ["Passenger", "Bob Emailson"]]) +
          divider() +
          leg({
            label: `Depart · OA 815 · ${shortDate(out)}`, from: "SFO", fromCity: "San Francisco", to: "ORD", toCity: "Chicago O'Hare",
            departs: time(out), arrives: time(outLands), note: "Terminal 2 · Seat 14A"
          }, oceanic.color) +
          leg({
            label: `Return · OA 816 · ${shortDate(back)}`, from: "ORD", fromCity: "Chicago O'Hare", to: "SFO", toCity: "San Francisco",
            departs: time(back), arrives: time(backLands), note: "Terminal 1 · Seat 15A"
          }, oceanic.color) +
          button("Manage booking", oceanic.color),
      }),
      { read: true },
    ),
    notice(
      "The Lakeview Hotel <reservations@lakeviewhotel.example>",
      "Reservation confirmed: The Lakeview Hotel, Chicago",
      44 * 24,
      now,
      ldScript(stay("LV-90215", "The Lakeview Hotel", "Chicago", "US", at(now, -34, 15), at(now, -30, 11))) +
      email(lakeview, {
        body:
          heading("We look forward to welcoming you") +
          details([
            ["Reservation", "LV-90215"],
            ["Check-in", shortDate(at(now, -34, 15))],
            ["Check-out", shortDate(at(now, -30, 11))],
            ["Room", "Lake View Queen · 4 nights"],
          ]) +
          button("View reservation", lakeview.color),
      }),
      { read: true },
    ),
  ];
};

/** Orders on their way: one per carrier, so each kind of parcel card shows. */
const purchases = (now: number): FakeMessageSpec[] => [
  notice(
    "ExtraGreen Laboratories Inc <orders@extragreenlabs.example>",
    "Shipment notification: order #20417",
    3,
    now,
    email(extraGreen, {
      preheader: "Order #20417 has been released for shipment. Estimated delivery: 2–3 business days.",
      body:
        heading("Shipment notification") +
        para("Dear Customer, order <b>#20417</b> has passed quality assurance and was released for shipment from Growth Facility 2 at 06:00.") +
        progress(["Ordered", "Certified", "Shipped", "Delivered"], 2, extraGreen.color) +
        para("Carrier: UPS<br>Tracking number: <b>1Z999AA10123456784</b>") +
        button("Track your package", extraGreen.color) +
        divider() +
        items(
          [
            { thumb: monstera, name: "ExtraGreen™ cultivar 7", detail: "6\" grower pot · Qty 1", price: "$38.00" },
            { thumb: pot, name: "Advanced Composite Pot", detail: "8\" with saucer · Qty 1", price: "$16.00" },
          ],
          [["Subtotal", "$54.00"], ["Shipping", "$7.95"], ["Tax", "$4.86"], ["Total", "$66.81"]],
        ) +
        small("Care protocol: maintain bright, indirect light and water every 7 days. Cultivar 7 is not rated for direct sunlight."),
      reason: "This is a transactional message regarding order #20417 placed at extragreenlabs.example.",
    }),
    { attachments: [{ name: "Invoice-20417.pdf", contentType: "application/pdf", size: 48_211 }] },
  ),
  notice(
    "Total Booksellers <orders@totalbooksellers.example>",
    "Delivery update: your order is out for delivery",
    6,
    now,
    email(totalBooks, {
      preheader: "Your order is scheduled for delivery today by 8:00 PM.",
      body:
        heading("Delivery update") +
        para("Your order is out for delivery and is scheduled to arrive today by 8:00 PM. No action is required at this time.") +
        progress(["Ordered", "Shipped", "Out for delivery", "Delivered"], 2, totalBooks.color) +
        items(
          [{ thumb: birdBook, name: "A Field Guide to Coastal Birds", detail: "Hardcover · M. Albatross · Qty 1", price: "$27.50" }],
          [["Total", "$31.42"]],
        ) +
        para(
          `<a href="https://example.com/" style="color: ${buzz.color}; font-size: 14px; font-weight: bold; text-decoration: none">Share on Google Buzz</a>`,
          "margin-top: 10px; text-align: right",
        ) +
        para("A complimentary eBook edition has been delivered to your registered device (Zune HD 6).") +
        para("USPS tracking: <b>9400100000000000000006</b>", "margin-top: 18px") +
        button("Track with USPS", totalBooks.color) +
        small("Customers who purchased this item also purchased <i>Gulls: A Defence</i> and <i>Is That a Heron?</i>"),
    }),
  ),
  notice(
    "The Hammock Hut <hello@hammockhut.example>",
    "Shipment confirmation: order #HH-88120",
    28,
    now,
    email(hammockHut, {
      preheader: "Your hammock is on its way. Time to start practising.",
      body:
        heading("Shipment confirmation") +
        para("Good news! Order <b>#HH-88120</b> has left the Hammock District and is on its way to you.") +
        progress(["Woven", "Shipped", "In transit", "Delivered"], 1, hammockHut.color) +
        items(
          [{ thumb: hammock, name: "The Lazy Afternoon two-person hammock", detail: "Cotton rope · hardwood spreader bars · Palm TouchStone 3 charging pocket", price: "$129.00" }],
          [["Shipping", "Free"], ["Total", "$140.18"]],
        ) +
        details([["Carrier", "FedEx Ground"], ["Tracking number", "123456789012"], ["Estimated delivery", "3–5 business days"]]) +
        button("Track shipment", hammockHut.color) +
        small("May result in increased engineering efficiency."),
    }),
  ),
];

const finance = (now: number): FakeMessageSpec[] => [
  notice(
    "Trade Federation Credit Union <statements@tradefedcu.example>",
    "Your October statement is ready",
    3 * 24 + 6,
    now,
    email(tradeFed, {
      preheader: "Your statement for Everyday Checking ••4417 is ready to view.",
      body:
        heading("Your statement is ready") +
        para("Hi Bob, your October statement for <b>Everyday Checking ••4417</b> is now available in online banking.") +
        details([
          ["Statement period", "Oct 1 – Oct 31"],
          ["Opening balance", "$3,218.40"],
          ["Deposits", "+$4,105.00"],
          ["Withdrawals", "−$3,662.17"],
          ["Closing balance", "$3,661.23"],
        ]) +
        button("View statement", tradeFed.color) +
        small("We will never ask for your password by email. Please note that any blockades you encounter are perfectly legal."),
      reason: "Federally insured by NCUA. Equal Housing Lender.",
    }),
  ),
  notice(
    "San Francisco Municipal Power Authority <billing@sfmpa.example>",
    "Your bill is ready: payment due in 5 days",
    7,
    now,
    email(sfmpa, {
      preheader: "Amount due: $64.12. Autopay will pay it on the due date.",
      body:
        heading("Your bill is ready") +
        figure("Amount due", "$64.12", `Due ${shortDate(new Date(now + 5 * DAY).toISOString())} · Autopay is on`, sfmpa.color) +
        details([["Account", "•••• 2291"], ["Usage this month", "212 kWh"], ["Compared to last year", "8% less ⚡"]]) +
        button("View bill", sfmpa.color) +
        small("Autopay will pay this from your checking account on the due date. You don't need to do anything."),
    }),
  ),
];

const social = (now: number): FakeMessageSpec[] => [
  notice(
    "Google Buzz <noreply@plus.google.com>",
    "34 new updates from your friends on Google Buzz",
    2 * 24 + 3,
    now,
    email(buzz, {
      preheader: "Julian Placeholder, Tessa Testington and 32 others posted while you were away.",
      body:
        heading("Catch up on Buzz", 22) +
        para("Julian Placeholder, Tessa Testington and 32 others posted while you were away.", "color: #555") +
        posts([
          { name: "Julian Placeholder", color: "#43a047", text: "I can't even imagine what the world would be like without posting all my updates to Google Buzz", meta: "12 comments · 3 hours ago" },
          { name: "Tessa Testington", color: "#f4b400", text: "Testing the latest beta of WebOS -- so many new features!", meta: "28 likes · 6 hours ago" },
          { name: "Sam Sampleton", color: "#1e88e5", text: "Has anyone tried to preorder the latest LG Prada Phone 7? It looks amazing!", meta: "4 comments · yesterday" },
        ]) +
        button("See all 34 updates", buzz.color),
      unsubscribe: true,
      reason: "You're receiving this because you turned on email updates for Buzz.",
    }),
    { read: true },
  ),
];

const promos = (now: number): FakeMessageSpec[] => [
  notice(
    "Peak Spice Outfitters <deals@peakspice.example>",
    "Fall sale: 30% off every jacket, now with more spice",
    26,
    now,
    email(peakSpice, {
      preheader: "Every jacket, 30% off, through Sunday. Now insulated with 100% pumpkin spice.",
      body:
        hero(fallHero, "Layer up for less", "30% off every jacket, through Sunday") +
        para("This season, every jacket is insulated with responsibly sourced pumpkin spice. Warm, breathable, and at least 26.5% more autumnal than down.") +
        productGrid([
          { thumb: jacket("#b5532f", "#3b2a20"), name: "Ridgeline Pumpkin Spice Down Jacket", price: "$153", was: "$219" },
          { thumb: jacket("#7b3f1d", "#d9c8a9"), name: "Switchback Cinnamon-Lined Shell", price: "$118", was: "$169" },
          { thumb: jacket("#8a6a4a", "#f2c14e"), name: "Summit Nutmeg Fleece", price: "$62", was: "$89" },
          { thumb: jacket("#d8b26e", "#5a3e22"), name: "Trailhead Allspice Chore Coat", price: "$97", was: "$139" },
        ]) +
        code("Use code at checkout", "SPICE30", peakSpice.color) +
        button("Shop the sale", peakSpice.color) +
        small("Note: may not contain pumpkin. Some restrictions apply."),
      unsubscribe: true,
      reason: "You're receiving this because you signed up for Peak Spice news and deals.",
    }),
    { headers: unsubscribe },
  ),
  notice(
    "Robusta Coffee Corporation <offers@robustacoffee.example>",
    "An offer regarding coffee",
    2 * 24 + 4,
    now,
    email(robusta, {
      preheader: "Robusta Coffee Corporation is pleased to offer coffee.",
      body:
        hero(coffeeHero, "Coffee", "Your first 2 months for $10") +
        para("Robusta Coffee Corporation is pleased to offer you coffee. Each month, one bag of coffee will be delivered to your address. It can be used to make coffee.") +
        details([["Product", "Coffee"], ["Coffee content", "At least 50.1%"], ["Bag size", "340 g"], ["After your trial", "$18/month"]]) +
        code("Your trial code", "COFFEE", robusta.color) +
        button("Start my subscription", robusta.color) +
        small("Robusta Coffee Corporation assures customers that its coffee is at least 50.1% coffee. Questions about the remaining 49.9% may be directed to Customer Communications."),
      unsubscribe: true,
    }),
    { headers: unsubscribe, read: true },
  ),
];

const updates = (now: number): FakeMessageSpec[] => [
  notice(
    "Freeman Dental <appointments@freemandental.example>",
    "Appointment reminder: cleaning on Thursday at 10:00",
    24 + 8,
    now,
    email(freeman, {
      preheader: "Your cleaning is Thursday at 10:00 AM with Dr. Kleiner.",
      body:
        hero(toothbrush, "", "") +
        heading("Rise and shine!") +
        para("It seems you have an upcoming appointment; if you were to miss it, there could be unforeseen consequences.") +
        details([["Appointment", "Cleaning &amp; check-up"], ["When", "Thursday, 10:00 AM"], ["With", "Dr. Isaac Kleiner"], ["Where", "Sector C, Suite 17"]]) +
        button("Confirm appointment", freeman.color) +
        small("Need to reschedule? Please give us 24 hours' notice. Parking is in Lot C. The shuttle tram to our office departs every 10 minutes."),
    }),
  ),
  notice(
    "Google Reader <noreply@reader.google.com>",
    "Google Reader turns 21 today",
    2 * 24 + 9,
    now,
    email(reader, {
      preheader: "Twenty-one years on, Google Reader is still the most popular way to read news online.",
      body:
        hero(readerHero, "", "") +
        heading("Happy 21st birthday, Reader!") +
        para("Twenty-one years on, Google Reader is still the most popular way to read news online. Here's your year in reading:") +
        details([["Items read", "48,213"], ["Subscriptions", "312"], ["Starred", "1,904"],]) +
        para("Thanks for reading with us. Here's to the next 21.", "margin-top: 18px") +
        button("Open Reader", reader.color),
      unsubscribe: true,
    }),
    { headers: unsubscribe, read: true },
  ),
];

export interface DemoSeed {
  mailbox: FakeMessengerOptions;
  /** NeoInbox-local state the mailbox can't carry. */
  pins: PinRecord[];
  reminders: ReminderRecord[];
}

export const demoSeed = (loadedAt = Date.now()): DemoSeed => {
  // Mail counts back from midnight, so all of it lands yesterday or earlier
  // and Today holds only the reminder, whatever time the page loads.
  const now = new Date(loadedAt).setHours(0, 0, 0, 0);
  const hike = thread(
    "Hiking next week?",
    [
      {
        from: "Tessa Testington <tessa.testington@example.com>",
        hoursAgo: 30,
        read: true,
        body: [
          "Hi all,",
          "Anyone up for a hike sometime next week?",
          "Tessa",
        ],
      },
      {
        from: "Sam Sampleton <sam.sampleton@example.com>",
        hoursAgo: 20,
        read: true,
        body: ["Sure! Should we switch this thread to messages? I just installed the latest Google Talk release.", "Sam"],
      },
      {
        from: "Julian Placeholder <julian.placeholder@example.com>",
        hoursAgo: 1.5,
        body: [
          "Sounds great, I'm in! I'll make sure everyone is added on the group message.",
          "J",
        ],
      },
    ],
    now,
    DEMO_ME,
    { plain: true },
  );
  const photos = thread(
    "Fresh from the stock photo mines",
    [
      {
        from: "Julian Placeholder <julian.placeholder@example.com>",
        hoursAgo: 52,
        read: true,
        body: [
          "Greetings,",
          "I have returned from my journey into the depths of the earth. It seems that once again the team dug too deeply and too greedily, unleashing a wide variety of unnamed horrors. Luckily, they had cleared them all out by the time I arrived, and I was able to collect a few photos. Check them out!",
          "J",
          "Sent from my Casio EXILIM K-Tai 10 Ultra",
          [
            "Photos from Unsplash: https://unsplash.com",
            "team.jpg by Jud Mackrill: https://unsplash.com/@judmackrill",
            "cake.jpg by Imants Kaziļuns: https://unsplash.com/@imants72",
            "handshake.jpg by Sebastian Herrmann: https://unsplash.com/@officestock",
            "mine.jpg by Dominik Vanyi: https://unsplash.com/@dominik_photography",
          ].join("\n"),
        ],
      },
    ],
    now,
    DEMO_ME,
    { plain: true },
  );
  photos.inbox[0]!.attachments = [
    { name: "team.jpg", contentType: "image/jpeg", size: 2_700_000, file: teamPhoto },
    { name: "cake.jpg", contentType: "image/jpeg", size: 1_900_000, file: cakePhoto },
    { name: "handshake.jpg", contentType: "image/jpeg", size: 2_100_000, file: handshakePhoto },
    { name: "mine.jpg", contentType: "image/jpeg", size: 2_400_000, file: minePhoto },
  ];

  const planning = thread(
    "Q4 pipeline sync: action items",
    [
      {
        from: "Miller Meter <miller.meter@example.com>",
        hoursAgo: 5,
        body: [
          "Team,",
          "Thanks for a productive sync. Circling back with key takeaways:",
          "- Leverage cross-functional synergies in the enterprise vertical\n- Move the needle on Q4 pipeline before EOQ\n- Take the Henderson account offline for a deeper dive\n- Socialize the new pricing tiers with stakeholders",
          "Please action the above by COB Friday. Let's keep the momentum going.",
          "Best,\nMiller\n\nMiller Meter | Director, Strategic Revenue Enablement",
        ],
      },
      {
        from: "me",
        hoursAgo: 4,
        body: ["Thanks Miller. Happy to own the Henderson deep dive. Will circle back with a high-level deck by Thursday.", "Bob"],
      },
      {
        from: "Miller Meter <miller.meter@example.com>",
        hoursAgo: 2,
        body: ["Love it. Let's put a pin in it and revisit at the all-hands.", "Sent from my HP TouchPad Pro Max"],
      },
    ],
    now,
    DEMO_WORK_ME,
    { plain: true },
  );
  const review = thread(
    "Quick sync re: Q4 deck alignment",
    [
      {
        from: "Rob Robertson <rob.robertson@example.com>",
        hoursAgo: 26,
        body: [
          "Hi Bob, hope this finds you well.",
          "Do you have bandwidth for a quick 15-minute touchpoint Thursday? I'd like to make sure we're aligned on the Q4 deck before we socialize it with leadership.",
          "Happy to flex around your calendar. Mornings are best on my end.",
          "Best regards,\nRob\n\nRob Robertson | Senior Manager, Go-To-Market",
        ],
      },
    ],
    now,
    DEMO_WORK_ME,
    { plain: true },
  );

  // A few things already marked done, so Done isn't empty on first look.
  const done = [
    ...lisbonTrip(now),
    ...chicagoTrip(now),
    notice(
      "ExtraGreen Laboratories Inc <orders@extragreenlabs.example>",
      "Delivery confirmation: order #19876",
      12 * 24,
      now,
      email(extraGreen, {
        body:
          heading("Delivery confirmation") +
          para("Order <b>#19876</b> was delivered to the front door. Please water all specimens within 24 hours of receipt.") +
          progress(["Ordered", "Packed", "Shipped", "Delivered"], 3, extraGreen.color) +
          button("Rate your order", extraGreen.color),
      }),
      { read: true },
    ),
    notice(
      "San Francisco Municipal Power Authority <billing@sfmpa.example>",
      "Payment received, thank you",
      20 * 24,
      now,
      email(sfmpa, {
        body:
          heading("Payment received") +
          figure("Amount paid", "$58.40", "Thank you! Your balance is now $0.00.", "#2e7d32") +
          details([["Account", "•••• 2291"], ["Paid with", "Autopay · checking ••4417"]]),
      }),
      { read: true },
    ),
  ];

  const inbox = [
    ...hike.inbox,
    ...photos.inbox,
    ...laTrip(now),
    ...purchases(now),
    ...finance(now),
    ...social(now),
    ...promos(now),
    ...updates(now),
  ];

  const mailbox: FakeMessengerOptions = {
    accounts: [
      {
        id: "dev",
        name: DEMO_ME,
        identities: [{ email: DEMO_ME, name: "Bob Emailson" }],
        folders: [
          { id: INBOX, name: "Inbox", specialUse: ["inbox"], messages: inbox },
          { id: "sent", name: "Sent", specialUse: ["sent"], messages: hike.sent },
          { id: "drafts", name: "Drafts", specialUse: ["drafts"] },
          { id: ARCHIVE, name: "Archives", specialUse: ["archives"], messages: done },
        ],
      },
      {
        id: "work",
        name: "Work",
        identities: [{ email: DEMO_WORK_ME, name: "Bob Emailson" }],
        folders: [
          { id: "work-inbox", name: "Inbox", specialUse: ["inbox"], messages: [...planning.inbox, ...review.inbox] },
          { id: "work-sent", name: "Sent", specialUse: ["sent"], messages: planning.sent },
          { id: "work-archive", name: "Archives", specialUse: ["archives"] },
        ],
      },
    ],
    contacts: [
      { emails: [DEMO_ME, DEMO_WORK_ME], name: "Bob Emailson" },
      { emails: ["tessa.testington@example.com"], name: "Tessa Testington" },
      { emails: ["julian.placeholder@example.com"], name: "Julian Placeholder" },
      { emails: ["sam.sampleton@example.com"], name: "Sam Sampleton" },
      { emails: ["miller.meter@example.com"], name: "Miller Meter" },
      { emails: ["rob.robertson@example.com"], name: "Rob Robertson" },
    ],
  };

  return {
    mailbox,
    pins: [],
    reminders: [
      { id: "demo-pack", text: "Pack for the trip", createdAt: loadedAt, status: "active", pinned: false, accountId: "dev" },
      { id: "demo-slides", text: "Send the Q4 deck to Rob", createdAt: loadedAt, status: "active", pinned: false, accountId: "work" },
    ],
  };
};

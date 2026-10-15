/**
 * Layout patterns the extractors must read, as minimal synthetic HTML (the
 * real-mail suite in src/eval/ is local-only). Each case is a shape seen in
 * actual booking mail; the comment names the sender it came from.
 */
import { describe, expect, it } from "vitest";
import { runExtractors } from ".";
import { buildExtractorInput } from "../samples";
import { dayOf } from "../scoreReservation";
import { htmlToLines } from "./layout";
import { findConfirmationCodes } from "./text";

const MESSAGE_DATE = new Date(2026, 6, 25, 12).getTime();

const run = (author: string, subject: string, html: string, date = MESSAGE_DATE) =>
  runExtractors(buildExtractorInput({ author, subject, date, textParts: [], htmlParts: [html] }));

const legs = (hit: ReturnType<typeof run>): string[] =>
  (hit?.segments ?? []).map((s) =>
    [s.kind, dayOf(s.start), s.end !== undefined ? dayOf(s.end) : "", s.origin ?? "", s.destination ?? ""]
      .filter(Boolean)
      .join(" "),
  );

const table = (...rows: string[][]): string =>
  `<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;

describe("htmlToLines", () => {
  it("keeps a table row's cells on one line and skips hidden preheaders", () => {
    const lines = htmlToLines(
      `<div style="display:none">preview text</div>${table(["SFO", "BOS"], ["6:30 AM", "2:44 PM"])}<p>Footer</p>`,
    );
    expect(lines.map((l) => l.text)).toEqual(["SFO | BOS", "6:30 AM | 2:44 PM", "Footer"]);
    expect(lines[0]!.cells).toEqual(["SFO", "BOS"]);
  });

  it("separates abutting inline elements", () => {
    const [line] = htmlToLines("<p><span>52B7D9</span><span>LOS ANGELES</span></p>");
    expect(line!.text).toBe("52B7D9 LOS ANGELES");
  });
});

describe("flight legs", () => {
  it("dates each row-form leg from the day header above it (AA)", () => {
    const html =
      "<p>Record Locator: RZKMVA</p>" +
      table(["Monday, December 19, 2026"]) +
      table(["SFO", "BOS"], ["6:30 AM", "2:44 PM"], ["AA 260"]) +
      table(["Monday, December 26, 2026"]) +
      table(["BOS", "SFO"], ["3:55 PM", "7:14 PM"], ["AA 261"]);
    const hit = run("no-reply@info.email.aa.com", "Your trip confirmation (SFO - BOS)", html);
    expect(legs(hit)).toEqual(["flight 2026-12-19 SFO BOS", "flight 2026-12-26 BOS SFO"]);
    expect(hit?.confirmationCodes).toContain("RZKMVA");
  });

  it("pairs stacked single-airport rows and ignores the arrival date (ZIPAIR)", () => {
    const html =
      "<p>Confirmation Number | QZA7W3</p>" +
      table(["DEP"], ["August 22,2026 17:15"], ["SFO"], ["San Francisco"]) +
      table(["ARR"], ["August 23,2026 20:00"], ["NRT"], ["Tokyo(Narita)"]);
    const hit = run("info@zipair.net", "ZIPAIR - Booking confirmation", html);
    expect(legs(hit)).toEqual(["flight 2026-08-22 SFO NRT"]);
  });

  it("drops a journey header whose connections are listed (Southwest)", () => {
    const html =
      table(["August 19"], ["BOS | SFO"]) +
      "<p>Confirmation # XK4PLM</p>" +
      table(["Wednesday, 08/19/2026"]) +
      table(["DEPARTS BOS 12:35PM Boston", "ARRIVES DEN 02:25PM Denver"]) +
      table(["DEPARTS DEN 03:45PM Denver", "ARRIVES SFO 05:20PM San Francisco"]) +
      table(["BOS - DEN", "18F - Standard"], ["DEN - SFO", "20A - Standard"]);
    const hit = run("southwest@ifly.southwest.com", "You're going to San Francisco on 08/19 (XK4PLM)!", html);
    expect(legs(hit)).toEqual(["flight 2026-08-19 BOS DEN", "flight 2026-08-19 DEN SFO"]);
  });

  it("turns a summary-only date range into outbound and return (Southwest)", () => {
    const html = table(["August 07 - August 10"]) + table(["HNL", "OGG"]) + "<p>Confirmation # 7HD3KR</p>";
    const hit = run("southwest@iluv.southwest.com", "Your 08/07 trip to Maui is all set.", html);
    expect(legs(hit)).toEqual(["flight 2026-08-07 HNL OGG", "flight 2026-08-10 OGG HNL"]);
  });

  it("does not read a departure | arrival date row as a range (United)", () => {
    const html =
      "<p>Confirmation Number: N84QTW</p>" +
      table(["Fri, Aug 28, 2026", "Sat, Aug 29, 2026"], ["San Francisco, CA, US (SFO)", "Seoul (ICN)"]);
    expect(legs(run("x@united.com", "eTicket Itinerary and Receipt", html))).toEqual([
      "flight 2026-08-28 SFO ICN",
    ]);
  });

  it("keeps a seat map's route from borrowing the next leg's date (United)", () => {
    const html =
      "<p>Confirmation Number: CX3TST</p>" +
      table(["Tue, Aug 12, 2026"], ["San Francisco, CA, US (SFO)", "Chicago, IL, US (ORD)"]) +
      table(["Sun, Aug 17, 2026"], ["Chicago, IL, US (ORD)", "San Francisco, CA, US (SFO)"]) +
      table(["Seats: SFO-ORD 14F"], ["ORD-SFO 30D"]);
    expect(legs(run("x@united.com", "eTicket Itinerary and Receipt", html))).toEqual([
      "flight 2026-08-12 SFO ORD",
      "flight 2026-08-17 ORD SFO",
    ]);
  });

  it("reads city names when the row also has a time (Spirit)", () => {
    const html =
      "<p>YOUR CONFIRMATION CODE | J5VRWD</p>" +
      table(
        ["THURSDAY, AUGUST 14, 2026", "TIME"],
        ["Seattle, WA", "4:13 PM"],
        ["Boston, MA", "12:36 AM+"],
      );
    expect(legs(run("x@fly.spirit-airlines.com", "Spirit Airlines Flight Confirmation: J5VRWD", html))).toEqual([
      "flight 2026-08-14 SEA BOS",
    ]);
  });

  it("ignores shouty prose and served-city lists", () => {
    const html =
      "<p>Confirmation code: ABC123</p>" +
      "<p>ADD BAGS</p><p>TSA PreCheck lanes are open.</p>" +
      `<p>${"We fly to New York (LGA), Newark, Orange County (SNA), Orlando and many more cities. ".repeat(2)}</p>` +
      "<p>Sat, Aug 22, 2026</p>";
    expect(run("x@united.com", "Your trip confirmation", html)).toBeNull();
  });

  it("returns nothing for holds and surveys", () => {
    const html = "<p>Record Locator: ZPWDHN</p>" + table(["Saturday, September 16, 2026"]) + table(["SFO", "BOS"]);
    expect(run("x@info.email.aa.com", "Trip On Hold - ZPWDHN", html)).toBeNull();
    expect(run("x@survey.av.aa.com", "Tell us about your trip", html)).toBeNull();
  });
});

describe("stays and rentals", () => {
  it("reads stacked check-in / check-out cards (booking.com)", () => {
    const html =
      "<p>Confirmation number 3901857264</p>" +
      table(["Check-in"], ["Mon, Oct 7, 2026"], ["from 15:00"]) +
      table(["Check-out"], ["Tue, Oct 8, 2026"], ["until 11:00"]);
    expect(legs(run("noreply@booking.com", "A reminder about your trip", html))).toEqual([
      "lodging 2026-10-07 2026-10-08",
    ]);
  });

  it("reads a column table of labels over values", () => {
    const html = "<p>Reservation ID 5520931</p>" + table(["Arrive", "Depart"], ["Aug 10, 2026", "Aug 12, 2026"]);
    expect(legs(run("x@messages.homeaway.com", "Your reservation", html))).toEqual([
      "lodging 2026-08-10 2026-08-12",
    ]);
  });

  it("reads labels inside a run-on paragraph (UFODRIVE)", () => {
    const html =
      "<p>Reference : SFC9876543210 Car : Tesla Starts : Wednesday, 26 August 2026 at 09:00 " +
      "Ends : Thursday, 27 August 2026 at 22:00 Mileage included : 150mi</p>";
    expect(legs(run("x@ufodrive.com", "UFODRIVE - Your booking SFC9876543210 is confirmed", html))).toEqual([
      "rental 2026-08-26 2026-08-27",
    ]);
  });

  it("falls back to an unlabeled range for the sender's own template (Airbnb)", () => {
    const html = "<p>Sun, Aug 7, 2026 Tue, Aug 9, 2026 Entire home/apt Confirmation code: HMQ4XZ7T2N</p>";
    expect(legs(run("automated@airbnb.com", "Your receipt from Airbnb", html))).toEqual([
      "lodging 2026-08-07 2026-08-09",
    ]);
  });

  it("only trusts other senders with both labeled ends and a code", () => {
    const labeled = "<p>Confirmation: 48213KX907651</p>" + table(["Check-in", "Aug 19, 2026"], ["Check-out", "Aug 21, 2026"]);
    expect(legs(run("hotel@example-inn.com", "Your stay", labeled))).toEqual(["lodging 2026-08-19 2026-08-21"]);
    const loose = table(["Arrival", "Aug 19, 2026"]);
    expect(run("shop@example-store.com", "Your order", loose)).toBeNull();
  });
});

describe("confirmation codes", () => {
  it("takes capitalized codes after a label, not the prose that follows one", () => {
    const text = "Full itinerary\nConfirmation # 7HD3KR PASSENGER\nThanks for confirming your emails";
    expect(findConfirmationCodes(text)).toEqual(["7HD3KR"]);
  });

  it("reads codes from the subject, dashed and suffixed forms included", () => {
    expect(findConfirmationCodes("", "Passengers cleared for 03/17 Las Vegas trip 9TF27Q.")).toEqual(["9TF27Q"]);
    expect(findConfirmationCodes("", "Alex's 03/17 Boston trip (482XWJ)")).toEqual(["482XWJ"]);
    expect(findConfirmationCodes("Payment Request for reservation HA-Q8M45R")).toEqual(["HA-Q8M45R"]);
    expect(findConfirmationCodes("Your confirmation number is 7130582946_1")).toEqual(["7130582946"]);
  });
});

describe("JSON-LD", () => {
  it("keeps the venue's wall-clock date regardless of offset (OpenTable)", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@context": "http://schema.org",
      "@type": "FoodEstablishmentReservation",
      reservationNumber: "2984016353",
      startTime: "2026-07-25T20:00:00-07:00",
      reservationFor: { "@type": "FoodEstablishment", name: "The Example Grill" },
    })}</script>`;
    expect(legs(run("x@opentable.com", "Your reservation", html))).toEqual(["dining 2026-07-25"]);
  });
});

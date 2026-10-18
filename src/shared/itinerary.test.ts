import { describe, expect, it } from "vitest";
import { buildItinerary, formatWhen, itineraryMessage } from "./itinerary";
import type { ReservationRecord, ReservationSegment } from "./types";

const NOW = new Date(2026, 9, 1).getTime();
const at = (month: number, day: number, h = 0, m = 0) => new Date(2026, month, day, h, m).getTime();

const record = (segments: ReservationSegment[], over: Partial<ReservationRecord> = {}): ReservationRecord => ({
  key: `<${Math.random().toString(36).slice(2)}@x>`,
  messageDate: NOW,
  senderDomain: "alaskaair.com",
  extractorVersion: 1,
  extractor: "jsonld",
  status: "extracted",
  segments,
  confirmationCodes: [],
  scannedAt: NOW,
  ...over,
});

describe("buildItinerary", () => {
  it("phrases flights like Inbox and orders them by departure", () => {
    const items = buildItinerary(
      [
        record([{ kind: "flight", start: at(11, 4, 7, 57), end: at(11, 4, 10, 48), origin: "BOS", destination: "SFO", summary: "AS 1141 BOS → SFO" }]),
        record([{ kind: "flight", start: at(10, 22, 22, 10), end: at(10, 23, 6, 10), origin: "SFO", destination: "EWR", summary: "AS 1182 SFO → EWR" }]),
      ],
      NOW,
    );
    expect(items.map((i) => [i.title, i.when])).toEqual([
      ["San Francisco to New York – AS 1182", "Nov 22, 10:10 PM – Nov 23, 6:10 AM"],
      ["Boston to San Francisco – AS 1141", "Dec 4, 7:57 AM – 10:48 AM"],
    ]);
  });

  it("keeps one line per booking, preferring the email with times", () => {
    const vague = record([{ kind: "flight", start: at(10, 22), origin: "SFO", destination: "EWR" }], { messageDate: NOW - 1 });
    const exact = record([{ kind: "flight", start: at(10, 22, 22, 10), origin: "SFO", destination: "EWR", summary: "AS 1182 SFO → EWR" }]);
    const items = buildItinerary([exact, vague], NOW);
    expect(items).toHaveLength(1);
    expect(items[0]!.when).toBe("Nov 22, 10:10 PM");
  });

  it("drops cancelled reservations", () => {
    expect(buildItinerary([record([{ kind: "lodging", start: at(10, 22) }], { status: "cancelled" })], NOW)).toEqual([]);
  });
});

describe("formatWhen", () => {
  it("shows dates alone when the email gave no time", () => {
    expect(formatWhen(at(10, 22), at(10, 25), NOW)).toBe("Nov 22 – Nov 25");
  });
  it("adds the year outside the current one", () => {
    expect(formatWhen(new Date(2018, 11, 22).getTime(), undefined, NOW)).toBe("Dec 22, 2018");
  });
});

describe("itineraryMessage", () => {
  it("writes the itinerary out, leaving confirmation codes behind", () => {
    const [item] = buildItinerary(
      [record([{ kind: "flight", start: at(10, 22, 22, 10), origin: "SFO", destination: "EWR", summary: "AS 1182 SFO → EWR" }], { confirmationCodes: ["GFQVKA"] })],
      NOW,
    );
    const message = itineraryMessage("Trip to New York", "Nov 22–25, 2026", [item!]);
    expect(message.subject).toBe("Trip to New York (Nov 22–25, 2026)");
    expect(message.text).toBe(
      "Trip to New York\nNov 22–25, 2026\n\nSan Francisco to New York – AS 1182\nNov 22, 10:10 PM",
    );
    expect(message.html).not.toContain("GFQVKA");
    expect(message.html).toContain("<b>Trip to New York</b>");
  });
});

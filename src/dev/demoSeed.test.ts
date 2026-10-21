/**
 * The demo mailbox is only worth anything if each message lands where it is
 * meant to show off. Rules move; this catches a change that would quietly
 * empty a bundle, drop a parcel card or lose a trip from the public demo.
 */
import { describe, expect, it } from "vitest";
import { classifyByRules } from "../classifier/pipeline";
import { extractFeatures } from "../classifier/features";
import { matchesTravel } from "../classifier/rules/travel";
import { buildExtractorInput } from "../classifier/samples";
import { findParcels } from "../classifier/extractors/tracking";
import { runExtractors } from "../classifier/extractors";
import type { FakeMessageSpec } from "../test/fakeMessenger";
import { demoSeed } from "./demoSeed";

const { mailbox } = demoSeed(Date.UTC(2026, 9, 20, 12));
const inbox: FakeMessageSpec[] = mailbox.accounts.flatMap((a) =>
  a.folders.filter((f) => f.specialUse?.includes("inbox")).flatMap((f) => f.messages ?? []),
);

const header = (m: FakeMessageSpec) =>
  ({ author: m.author!, subject: m.subject! }) as messenger.messages.MessageHeader;

const input = (m: FakeMessageSpec) =>
  buildExtractorInput({
    author: m.author!,
    subject: m.subject!,
    date: new Date(m.date!).getTime(),
    textParts: m.text ? [m.text] : [],
    htmlParts: m.html ? [m.html] : [],
  });

/** Bundle by subject; travel mail is listed as "trip", since a trip claims it. */
const EXPECTED: Record<string, string | null> = {
  "Hiking next week?": null,
  "Re: Hiking next week?": null,
  "Fresh from the stock photo mines": null,
  "Q4 pipeline sync: action items": null,
  "Re: Q4 pipeline sync: action items": null,
  "Quick sync re: Q4 deck alignment": null,
  "Your train tickets: San Francisco → Los Angeles": "trip",
  "Reservation confirmed: Hollywood Tower Hotel, Los Angeles": "trip",
  "Shipment notification: order #20417": "purchases",
  "Delivery update: your order is out for delivery": "purchases",
  "Shipment confirmation: order #HH-88120": "purchases",
  "Your October statement is ready": "finance",
  "Your bill is ready: payment due in 5 days": "finance",
  "34 new updates from your friends on Google Buzz": "social",
  "Fall sale: 30% off every jacket, now with more spice": "promos",
  "An offer regarding coffee": "promos",
  "Appointment reminder: cleaning on Thursday at 10:00": "updates",
  "Google Reader turns 21 today": "updates",
};

describe("demo mailbox", () => {
  it("has an expectation for every inbox message", () => {
    expect([...new Set(inbox.map((m) => m.subject))].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const m of inbox) {
    const want = EXPECTED[m.subject!];
    it(`${m.subject} -> ${want ?? "no bundle"}`, () => {
      if (want === "trip") {
        expect(matchesTravel(extractFeatures(header(m), m.headers ?? {}))).toBe(true);
        expect(runExtractors(input(m))?.segments.length).toBeGreaterThan(0);
      } else {
        expect(classifyByRules(extractFeatures(header(m), m.headers ?? {}))).toBe(want);
      }
    });
  }

  it("gives each shipping notice a parcel card", () => {
    const carriers = inbox.flatMap((m) => findParcels(input(m)).map((p) => p.carrier));
    expect(carriers.sort()).toEqual(["fedex", "ups", "usps"]);
  });
});

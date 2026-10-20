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
  "Hike on Saturday?": null,
  "Re: Hike on Saturday?": null,
  "Dinner at ours on Friday": null,
  "Photos from the reunion": null,
  "Re: Lisbon recommendations": null,
  "Q4 planning notes": null,
  "Re: Q4 planning notes": null,
  "Design review moved to Thursday": null,
  "Your flight confirmation RVX4QM — San Francisco to Lisbon": "trip",
  "Reservation confirmed: Casa do Miradouro, Lisbon": "trip",
  "Your table for 2 is booked": "trip",
  "Your train tickets: San Francisco → Los Angeles": "trip",
  "Reservation confirmed: Hollywood Tower Hotel, Los Angeles": "trip",
  "Your order #20417 has shipped": "purchases",
  "Your package is out for delivery": "purchases",
  "Shipped: your standing desk": "purchases",
  "Your receipt from Little Fern Café": "purchases",
  "Your October statement is ready": "finance",
  "Your bill is ready: payment due in 5 days": "finance",
  "Your pay stub is available": "finance",
  "Priya Raman gave you kudos": "social",
  "New event: Sunday Sketch Club at the Botanical Garden": "social",
  "34 new updates from your friends on Google Buzz": "social",
  "Fall sale: 30% off every jacket": "promos",
  "Free shipping this weekend only": "promos",
  "Your first 2 months for $10": "promos",
  "New arrivals: the indoor jungle collection": "promos",
  "Appointment reminder: cleaning on Thursday at 10:00": "updates",
  "New sign-in to your account": "updates",
  "The Weekly Byte: Google Reader turns 21": "updates",
  "[bayclimbers] Gym night moves to Wednesday": "forums",
  "[maple-street] Has anyone seen a grey cat?": "forums",
};

describe("demo mailbox", () => {
  it("has an expectation for every inbox message", () => {
    expect(inbox.map((m) => m.subject).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const m of inbox) {
    const want = EXPECTED[m.subject!];
    it(`${m.subject} -> ${want ?? "no bundle"}`, () => {
      if (want === "trip") {
        // The dinner booking is no travel sender; the extract sweep still
        // reads it, by its subject, and the trip attaches it by date.
        if (m.subject !== "Your table for 2 is booked") {
          expect(matchesTravel(extractFeatures(header(m), m.headers ?? {}))).toBe(true);
        }
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

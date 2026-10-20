/**
 * Turning trips off: travel mail gets a plain Travel bundle, like Google
 * Inbox before it had trips, and turning them back on files it under Updates
 * again with the trips as they were.
 */
import { afterEach, describe, expect, it } from "vitest";
import { boot, type Booted } from "../test/boot";
import { INBOX, personalMail, shapes } from "../test/fixtures";
import { settle, type FakeMessengerOptions } from "../test/fakeMessenger";

let app: Booted | undefined;
afterEach(async () => {
  await app?.db.delete();
  app = undefined;
});

const open = async (options: FakeMessengerOptions): Promise<Booted> => {
  const booted = await boot(options);
  await booted.store().init();
  await booted.backfill.runBackfill();
  await settle();
  return booted;
};

const itinerary = () =>
  personalMail({ author: "Example Air <no-reply@air.example>", subject: "Your flight itinerary" });

const categories = (booted: Booted) =>
  Object.values(booted.store().messagesByKey).map((m) => [m.subject, m.category ?? null]);

describe("turning trips off", () => {
  it("moves travel mail between Updates and the Travel bundle", async () => {
    app = await open(shapes.standard([itinerary(), personalMail({ subject: "Lunch?" })]));
    expect(app.store().tripsEnabled).toBe(true);
    expect(categories(app)).toContainEqual(["Your flight itinerary", "updates"]);

    app.store().setTripsEnabled(false);
    await settle();
    expect(app.mail.storageData.tripsEnabled).toBe(false);
    expect(categories(app)).toEqual(
      expect.arrayContaining([
        ["Your flight itinerary", "travel"],
        ["Lunch?", null],
      ]),
    );

    app.store().setTripsEnabled(true);
    await settle();
    expect(categories(app)).toContainEqual(["Your flight itinerary", "updates"]);
  });

  it("files new travel mail in Travel while off", async () => {
    app = await open(shapes.standard([]));
    app.store().setTripsEnabled(false);
    await settle();

    await app.mail.deliver(INBOX, itinerary());
    await settle();

    expect(categories(app)).toEqual([["Your flight itinerary", "travel"]]);
  });

  it("starts with whatever was last chosen", async () => {
    const options = shapes.standard([itinerary()]);
    app = await boot(options);
    app.mail.storageData.tripsEnabled = false;
    await app.store().init();
    await app.backfill.runBackfill();
    await settle();

    expect(app.store().tripsEnabled).toBe(false);
    expect(categories(app)).toEqual([["Your flight itinerary", "travel"]]);
  });
});

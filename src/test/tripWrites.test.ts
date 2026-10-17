/**
 * Trip edits made in the SPA are written by the background, which is also
 * where the auto-clusterer writes. These drive the real store and background
 * through the port to check the two writers can't undo each other.
 */
import { describe, expect, it } from "vitest";
import { settle } from "./fakeMessenger";
import { boot, type Booted } from "./boot";
import { shapes } from "./fixtures";

/** Polls an async condition (waitFor's predicate is synchronous). */
const eventually = async (predicate: () => boolean | Promise<boolean>): Promise<void> => {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > 5_000) throw new Error("eventually() timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const open = async (): Promise<Booted> => {
  const app = await boot(shapes.standard());
  await app.store().init();
  await settle();
  return app;
};

describe("trip writes", () => {
  it("persists trips and memberships the SPA creates", async () => {
    const app = await open();
    const trip = app.store().createTrip("Lisbon");
    app.store().setTripMembership(["<a@x>", "<b@x>"], trip.id);
    await eventually(async () => (await app.db.tripMemberships.count()) === 2);

    expect(await app.db.trips.get(trip.id)).toMatchObject({ name: "Lisbon" });
    const rows = await app.db.tripMemberships.toArray();
    expect(rows.every((r) => r.tripId === trip.id && r.source === "manual")).toBe(true);
  });

  it("keeps a trip the SPA thinks is empty when the clusterer has added to it", async () => {
    const app = await open();
    const trip = app.store().createTrip("Lisbon");
    app.store().setTripMembership(["<a@x>"], trip.id);
    await eventually(async () => (await app.db.tripMemberships.count()) === 1);

    // The clusterer adds a message the SPA hasn't heard about yet.
    await app.db.tripMemberships.put({
      key: "<hotel@x>",
      tripId: trip.id,
      source: "auto",
      addedAt: Date.now(),
    });

    // Removing the SPA's only known member looks like it empties the trip.
    app.store().setTripMembership(["<a@x>"], null);
    expect(app.store().tripsById[trip.id]).toBeUndefined();

    await eventually(() => app.store().tripsById[trip.id] !== undefined);
    expect(await app.db.trips.get(trip.id)).toBeDefined();
    expect(await app.db.tripMemberships.get("<a@x>")).toMatchObject({ tripId: null });
  });

  it("deletes a trip once nothing points at it", async () => {
    const app = await open();
    const trip = app.store().createTrip("Lisbon");
    app.store().setTripMembership(["<a@x>"], trip.id);
    await eventually(async () => (await app.db.trips.count()) === 1);

    app.store().setTripMembership(["<a@x>"], null);
    await eventually(async () => (await app.db.trips.count()) === 0);
    await settle();
    expect(app.store().tripsById[trip.id]).toBeUndefined();
  });

  it("undo restores the trip and its memberships", async () => {
    const app = await open();
    const trip = app.store().createTrip("Lisbon");
    app.store().setTripMembership(["<a@x>"], trip.id);
    await eventually(async () => (await app.db.trips.count()) === 1);

    app.store().setTripMembership(["<a@x>"], null);
    await eventually(async () => (await app.db.trips.count()) === 0);
    app.store().toasts.at(-1)!.actions![0]!.run();

    await eventually(async () => (await app.db.trips.count()) === 1);
    expect(await app.db.tripMemberships.get("<a@x>")).toMatchObject({ tripId: trip.id });
    expect(app.store().tripMembershipByKey["<a@x>"]?.tripId).toBe(trip.id);
  });
});

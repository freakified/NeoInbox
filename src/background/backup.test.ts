/**
 * Settings → Advanced → Back up: export what the user set up, wipe it, and
 * import it back, as a reinstall would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boot, type Booted } from "../test/boot";
import { personalMail, shapes } from "../test/fixtures";
import { settle } from "../test/fakeMessenger";
import { parseBackup } from "../shared/backup";

let app: Booted | undefined;
let local: Map<string, string>;
beforeEach(() => {
  // Node's own localStorage stub shadows the DOM one here; give each test a fresh store.
  local = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => void local.set(k, v),
    removeItem: (k: string) => void local.delete(k),
  });
});
afterEach(async () => {
  await app?.db.delete();
  app = undefined;
});

const open = async (): Promise<Booted> => {
  const booted = await boot(
    shapes.standard([
      personalMail({ author: "Kestrel Yard <hello@kestrel.example>", subject: "Seed order" }),
      personalMail({ subject: "Lunch?" }),
    ]),
  );
  await booted.store().init();
  await booted.backfill.runBackfill();
  await settle();
  return booted;
};

const categoryOf = (booted: Booted, subject: string) =>
  Object.values(booted.store().messagesByKey).find((m) => m.subject === subject)?.category ?? null;

describe("backup", () => {
  it("restores bundles, rules and settings after a wipe", async () => {
    app = await open();
    const { buildBackup } = await import("../spa/lib/backup");
    app.store().setCustomBundle({ id: "garden", name: "Garden", color: "#33691e", icon: "eco", order: 0 });
    app.store().setRouteRule({
      id: "r1",
      target: "garden",
      type: "domain",
      value: "kestrel.example",
      createdAt: 1,
    });
    app.store().setTripsEnabled(false);
    localStorage.setItem("neoinbox.remoteImagePolicy", "always");
    await settle();
    expect(categoryOf(app, "Seed order")).toBe("garden");

    const text = JSON.stringify(await buildBackup());

    // What uninstalling does to it.
    await app.db.customBundles.clear();
    await app.db.routeRules.clear();
    delete app.mail.storageData.tripsEnabled;
    local.clear();
    // A setting the backup didn't have is removed, not kept.
    localStorage.setItem("neoinbox.defaultAccount", "account9");

    app.store().importBackup(parseBackup(text));
    await settle();

    expect(await app.db.customBundles.toArray()).toEqual([
      expect.objectContaining({ id: "garden", name: "Garden" }),
    ]);
    expect(await app.db.routeRules.toArray()).toEqual([
      expect.objectContaining({ id: "r1", value: "kestrel.example" }),
    ]);
    expect(app.mail.storageData.tripsEnabled).toBe(false);
    expect(localStorage.getItem("neoinbox.remoteImagePolicy")).toBe("always");
    expect(localStorage.getItem("neoinbox.defaultAccount")).toBeNull();
    const row = (await app.db.messages.toArray()).find((m) => m.subject === "Seed order");
    expect(row?.category).toBe("garden");
  });

  it("rejects files that aren't backups, or are damaged", () => {
    expect(() => parseBackup("not json")).toThrow("isn't a NeoInbox backup");
    expect(() => parseBackup(JSON.stringify({ format: "other", version: 1 }))).toThrow(
      "isn't a NeoInbox backup",
    );
    expect(() =>
      parseBackup(JSON.stringify({ format: "neoinbox-backup", version: 99 })),
    ).toThrow("newer NeoInbox");
    expect(() =>
      parseBackup(
        JSON.stringify({ format: "neoinbox-backup", version: 1, routeRules: [{ id: "r1" }] }),
      ),
    ).toThrow("rules are damaged");
  });

  it("keeps only the settings it knows", () => {
    const backup = parseBackup(
      JSON.stringify({
        format: "neoinbox-backup",
        version: 1,
        storage: { openMode: "window", inboxWindowBounds: { width: 1 } },
        localStorage: { "neoinbox.unifiedInbox": "1", "neoinbox.bundleSeen": "{}" },
      }),
    );
    expect(backup.storage).toEqual({ openMode: "window" });
    expect(backup.localStorage).toEqual({ "neoinbox.unifiedInbox": "1" });
    expect(backup.customBundles).toEqual([]);
  });
});

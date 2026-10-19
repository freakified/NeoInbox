/**
 * The archive import caches old archived mail as Done rows: listed from
 * headers first, then each message read in full so it is bundled right. The
 * reads are the user's to start — nothing else may fetch an archived body —
 * and a second run must not list or read anything twice.
 */
import { afterEach, describe, expect, it } from "vitest";
import { boot, type Booted } from "../test/boot";
import { ARCHIVE, headerOnlyPromoMail, INBOX, personalMail, shapes } from "../test/fixtures";
import { settle, type FakeMessengerOptions } from "../test/fakeMessenger";
import { DETAILS_LAZY, MESSAGE_DETAILS_VERSION } from "../shared/details";

const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365 * DAY;

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

const importArchive = async (a: Booted, since: number | null): Promise<void> => {
  const { runArchiveImport } = await import("./archiveImport");
  await runArchiveImport(since);
  await settle();
};

const doneRows = async (a: Booted) =>
  (await a.db.messages.toArray()).filter((m) => m.origin === "done");

describe("importing archived mail", () => {
  it("reads each archived message once, and bundles it from the whole message", async () => {
    app = await open(
      shapes.withArchive([], [
        personalMail({ author: "Shop <orders@shop.example>", subject: "Your order shipped" }),
        personalMail({ subject: "Old conversation" }),
        // Promos only by List-Unsubscribe, which the header alone doesn't carry.
        headerOnlyPromoMail({ subject: "50% off everything" }),
      ]),
    );
    await app.db.routeRules.put({
      id: "r1", target: "purchases", type: "domain", value: "shop.example", createdAt: 0,
    });
    const bodies = app.mail.calls.getFull.length;

    await importArchive(app, null);
    // The background sweeps that run after scans must leave the rows alone too.
    await app.backfill.fillMissingDetails();
    await app.backfill.retryIncompleteClassifications();

    const rows = await doneRows(app);
    expect(rows.map((m) => m.subject).sort()).toEqual(["50% off everything", "Old conversation", "Your order shipped"]);
    expect(rows.find((m) => m.subject === "Your order shipped")?.category).toBe("purchases");
    expect(rows.find((m) => m.subject === "50% off everything")?.category).toBe("promos");
    expect(rows.every((m) => m.detailsVersion === MESSAGE_DETAILS_VERSION)).toBe(true);
    expect(app.mail.calls.getFull.length - bodies).toBe(3);
    expect(app.store().archiveImport).toMatchObject({ running: false, imported: 3, sorted: 3 });
  });

  it("leaves a message whose body can't be had for the next run", async () => {
    app = await open(shapes.withArchive([], [personalMail({ subject: "Not synced", bodyUnavailable: true })]));

    await importArchive(app, null);

    expect((await doneRows(app))[0]?.detailsVersion).toBe(DETAILS_LAZY);
  });

  it("reloads Done once the import finishes", async () => {
    app = await open(shapes.withArchive([], [personalMail({ subject: "Old conversation" })]));

    await importArchive(app, null);

    expect(
      Object.values(app.store().messagesByKey)
        .filter((m) => m.origin === "done")
        .map((m) => m.subject),
    ).toEqual(["Old conversation"]);
  });

  it("stops at the chosen date", async () => {
    app = await open(
      shapes.withArchive([], [
        personalMail({ subject: "Recent", date: Date.now() - 30 * DAY }),
        personalMail({ subject: "Ancient", date: Date.now() - 5 * YEAR }),
      ]),
    );

    await importArchive(app, Date.now() - 2 * YEAR);

    expect((await doneRows(app)).map((m) => m.subject)).toEqual(["Recent"]);
  });

  it("skips archive copies of mail still in the inbox", async () => {
    // Gmail's All Mail holds a copy of every inbox message.
    app = await open(
      shapes.withArchive(
        [personalMail({ headerMessageId: "<both@x>", subject: "Still in the inbox" })],
        [
          personalMail({ headerMessageId: "<both@x>", subject: "Still in the inbox" }),
          personalMail({ subject: "Only archived" }),
        ],
      ),
    );

    await importArchive(app, null);

    expect((await doneRows(app)).map((m) => m.subject)).toEqual(["Only archived"]);
  });

  it("imports nothing twice when run again", async () => {
    app = await open(shapes.withArchive([], [personalMail(), personalMail()]));
    await importArchive(app, null);

    app.mail.calls.enumeratedFolders.length = 0;

    await importArchive(app, null);

    expect(await doneRows(app)).toHaveLength(2);
    expect(app.store().archiveImport).toMatchObject({ imported: 0, sorted: 0 });
    // Already listed that far, so the archive isn't walked again.
    expect(app.mail.calls.enumeratedFolders).not.toContain(ARCHIVE);
  });

  it("reads the dated subfolders Thunderbird archives into", async () => {
    const options = shapes.withArchive([], [personalMail({ subject: "Top level" })]);
    const archive = options.accounts[0]!.folders.find((f) => f.id === ARCHIVE)!;
    archive.subFolders = [
      { id: `${ARCHIVE}-2025`, name: "2025", messages: [personalMail({ subject: "Filed by year" })] },
    ];
    app = await open(options);

    await importArchive(app, null);

    expect((await doneRows(app)).map((m) => m.subject).sort()).toEqual(["Filed by year", "Top level"]);
  });

  it("keeps a message marked done in NeoInbox as the one row", async () => {
    app = await open(shapes.withArchive([personalMail({ subject: "Done here" })], []));
    const target = app.mail.idsIn(INBOX)[0]!;
    app.store().doneThread([app.mail.keyOf(target)]);
    app.store().dismissToast(app.store().toasts.at(-1)!.id);
    await settle();

    await importArchive(app, null);

    expect((await doneRows(app)).map((m) => m.subject)).toEqual(["Done here"]);
  });
});

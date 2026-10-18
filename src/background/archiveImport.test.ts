/**
 * The archive import caches old archived mail as Done rows from headers
 * alone. The contract that matters most is what it must not do: fetch a
 * body, which on IMAP downloads mail the user never asked for.
 */
import { afterEach, describe, expect, it } from "vitest";
import { boot, type Booted } from "../test/boot";
import { ARCHIVE, INBOX, personalMail, shapes } from "../test/fixtures";
import { settle, type FakeMessengerOptions } from "../test/fakeMessenger";

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
  it("caches archived mail as Done without fetching a single body", async () => {
    app = await open(
      shapes.withArchive([], [
        personalMail({ author: "Shop <orders@shop.example>", subject: "Your order shipped" }),
        personalMail({ subject: "Old conversation" }),
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
    expect(rows.map((m) => m.subject).sort()).toEqual(["Old conversation", "Your order shipped"]);
    expect(rows.find((m) => m.subject === "Your order shipped")?.category).toBe("purchases");
    expect(app.mail.calls.getFull.length).toBe(bodies);
    expect(app.store().archiveImport).toMatchObject({ running: false, imported: 2 });
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

    await importArchive(app, null);

    expect(await doneRows(app)).toHaveLength(2);
    expect(app.store().archiveImport).toMatchObject({ imported: 0, scanned: 2 });
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

/**
 * The inbox import loads inbox mail older than the scan window, for inboxes
 * far bigger than it: every message listed from its header first, then each
 * read in full so it lands in the right bundle. What it must not do is let
 * anything else read the messages a stopped load left header-only, or let the
 * next scan delete what was loaded.
 */
import { afterEach, describe, expect, it } from "vitest";
import { boot, type Booted } from "../test/boot";
import { headerOnlyPromoMail, INBOX, many, personalMail, promoMail, shapes } from "../test/fixtures";
import { settle, type FakeMessageSpec, type FakeMessengerOptions } from "../test/fakeMessenger";
import { DETAILS_LAZY, MESSAGE_DETAILS_VERSION } from "../shared/details";

const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365 * DAY;
const CAP = 3;

let app: Booted | undefined;
afterEach(async () => {
  await app?.db.delete();
  app = undefined;
});

/** Boots with a small scan window, so a dozen messages is a "large" inbox. */
const open = async (options: FakeMessengerOptions): Promise<Booted> => {
  const booted = await boot(options);
  booted.mail.storageData["neoinbox-inbox-cap"] = CAP;
  await booted.store().init();
  await booted.backfill.runBackfill();
  await settle();
  return booted;
};

const background = async () => ({
  ...(await import("./inboxImport")),
  ...(await import("./archiveImport")),
  ...(await import("./extract")),
  ...(await import("./archiveJob")),
});

const importInbox = async (since: number | null): Promise<void> => {
  const { runInboxImport } = await background();
  await runInboxImport(since);
  await settle();
};

const inboxRows = async (a: Booted) =>
  (await a.db.messages.toArray()).filter((m) => m.origin === "inbox");

/**
 * What a load stopped after its header pass leaves: every inbox message the
 * window left out, cached from its header alone.
 */
const listOnly = async (a: Booted): Promise<void> => {
  const { headerOnlyRow } = await background();
  for (const id of a.mail.idsIn(INBOX)) {
    if (await a.db.messages.get(a.mail.keyOf(id))) continue;
    await a.db.messages.put(await headerOnlyRow(await messenger.messages.get(id), "inbox"));
  }
  await a.store().reloadInbox();
};

/** `n` recent messages, plus anything older passed in. */
const inbox = (n: number, older: FakeMessageSpec[] = []): FakeMessengerOptions =>
  shapes.standard([...older, ...many(n, promoMail, Date.now() - DAY)]);

/** A round trip booked `daysAgo` days back: a trip candidate by subject alone. */
const oldBooking = (daysAgo: number): FakeMessageSpec =>
  personalMail({
    author: "JAL <info@jal.example>",
    subject: "Your booking confirmation KYT8Q2",
    date: Date.now() - daysAgo * DAY,
    text: "Confirmation code: KYT8Q2",
  });

describe("loading older inbox mail", () => {
  it("reads every older message in full, so it lands in the right bundle", async () => {
    // Promos only by List-Unsubscribe, which the header alone doesn't carry:
    // listed, these read as a person writing; read in full, as a campaign.
    app = await open(inbox(CAP, many(5, headerOnlyPromoMail, Date.now() - 200 * DAY)));
    expect(app.store().inboxWindow).toEqual({ cap: CAP, skipped: 5 });

    await importInbox(null);

    const rows = await inboxRows(app);
    expect(rows).toHaveLength(8);
    expect(rows.every((m) => m.detailsVersion === MESSAGE_DETAILS_VERSION)).toBe(true);
    expect(rows.every((m) => m.category === "promos")).toBe(true);
    expect(app.store().inboxImport).toMatchObject({ running: false, imported: 5, sorted: 5, toSort: 5 });
    expect(app.store().inboxWindow).toEqual({ cap: CAP, skipped: 0 });
  });

  it("shows the loaded mail in the inbox, sorted", async () => {
    app = await open(inbox(CAP, many(5, headerOnlyPromoMail, Date.now() - 200 * DAY)));

    await importInbox(null);

    const inStore = Object.values(app.store().messagesByKey).filter((m) => m.origin === "inbox");
    expect(inStore).toHaveLength(8);
    expect(inStore.every((m) => m.category === "promos")).toBe(true);
  });

  it("survives the next full scan instead of being pruned as stale", async () => {
    app = await open(inbox(8));
    await importInbox(null);
    const bodies = app.mail.calls.getFull.length;

    await app.backfill.runBackfill();
    await settle();

    expect(await inboxRows(app)).toHaveLength(8);
    expect(app.mail.calls.getFull.length).toBe(bodies);
    expect(app.store().inboxWindow).toEqual({ cap: CAP, skipped: 0 });
  });

  it("stops at the chosen date and keeps counting what's left", async () => {
    const older = [
      personalMail({ subject: "Last spring", date: Date.now() - 200 * DAY }),
      personalMail({ subject: "Years ago", date: Date.now() - 3 * YEAR }),
    ];
    app = await open(inbox(CAP, older));

    await importInbox(Date.now() - YEAR);

    expect((await inboxRows(app)).map((m) => m.subject)).toContain("Last spring");
    expect((await inboxRows(app)).map((m) => m.subject)).not.toContain("Years ago");
    expect(app.store().inboxWindow).toEqual({ cap: CAP, skipped: 1 });
  });

  it("keeps the widest import as the inbox's reach", async () => {
    app = await open(inbox(CAP));
    const { inboxCovers, getInboxImportStatus } = await background();
    const fiveYears = Date.now() - 5 * YEAR;
    await importInbox(fiveYears);
    await importInbox(Date.now() - YEAR);

    expect(await getInboxImportStatus()).toMatchObject({ coveredSince: fiveYears });
    expect(await inboxCovers(Date.now() - 2 * YEAR)).toBe(true);
    expect(await inboxCovers(null)).toBe(false);
  });

  it("finishes reading what a stopped load listed, without listing again", async () => {
    app = await open(inbox(8));
    await importInbox(null);
    await listOnly(app);
    // Pretend the reads never happened: the rows a stopped load leaves.
    for (const m of await inboxRows(app)) {
      if (m.tbId <= app.mail.idsIn(INBOX)[4]!) {
        await app.db.messages.put({ ...m, detailsVersion: DETAILS_LAZY, attachments: [], references: [], inReplyTo: [] });
      }
    }
    app.mail.calls.enumeratedFolders.length = 0;

    await importInbox(null);

    expect(app.mail.calls.enumeratedFolders).not.toContain(INBOX);
    expect((await inboxRows(app)).every((m) => m.detailsVersion === MESSAGE_DETAILS_VERSION)).toBe(true);
    expect(app.store().inboxImport).toMatchObject({ imported: 0, sorted: 5 });
  });

  it("counts two copies of one message as one, so everything means nothing left", async () => {
    const copy = { subject: "Sent twice", date: Date.now() - 200 * DAY, headerMessageId: "twice@example.test" };
    app = await open(inbox(CAP, [personalMail(copy), personalMail(copy)]));

    await importInbox(null);

    expect(app.store().inboxWindow).toEqual({ cap: CAP, skipped: 0 });
    // And the next full scan agrees.
    await app.backfill.runBackfill();
    await settle();
    expect(app.store().inboxWindow).toEqual({ cap: CAP, skipped: 0 });
  });

  it("doesn't read a duplicate as drift on every sync", async () => {
    const copy = { subject: "Sent twice", date: Date.now() - 200 * DAY, headerMessageId: "twice@example.test" };
    app = await open(inbox(CAP, [personalMail(copy), personalMail(copy)]));
    await importInbox(null);
    const lists = app.mail.calls.list;

    await app.backfill.runIncrementalSync();
    await settle();

    expect(app.mail.calls.list).toBe(lists);
  });

  it("doesn't read a capped inbox as drifted on every sync", async () => {
    app = await open(inbox(8));
    const lists = app.mail.calls.list;

    await app.backfill.runIncrementalSync();
    await settle();

    // A drifted folder gets a full revisit, which lists it from the top.
    expect(app.mail.calls.list).toBe(lists);
  });

  it("reads only the inbox folder", async () => {
    app = await open(inbox(8));
    app.mail.calls.enumeratedFolders.length = 0;

    await importInbox(null);

    expect(new Set(app.mail.calls.enumeratedFolders)).toEqual(new Set([INBOX]));
  });
});

describe("mail a stopped load left header-only", () => {
  it("isn't read by any background sweep", async () => {
    app = await open(inbox(8));
    await listOnly(app);
    const bodies = app.mail.calls.getFull.length;

    await app.backfill.runBackfill();
    await settle();
    await app.backfill.fillMissingDetails();
    await app.backfill.retryIncompleteClassifications();

    expect(app.mail.calls.getFull.length).toBe(bodies);
    expect((await inboxRows(app)).filter((m) => m.detailsVersion === DETAILS_LAZY)).toHaveLength(5);
  });

  it("is reclassified for a new rule from headers alone", async () => {
    app = await open(inbox(8));
    await listOnly(app);
    const bodies = app.mail.calls.getFull.length;

    app.store().setRouteRule({
      id: "r1", target: "updates", type: "domain", value: "shop.example", createdAt: 0,
    });
    await settle(40);

    const rows = await inboxRows(app);
    expect(rows.every((m) => m.category === "updates")).toBe(true);
    // The rule reaches the windowed rows the usual way; the rest stay headers.
    expect(app.mail.calls.getFull.length - bodies).toBeLessThanOrEqual(CAP);
    expect(rows.filter((m) => m.detailsVersion === DETAILS_LAZY)).toHaveLength(5);
  });

  it("gets its body once the scan window reaches it", async () => {
    app = await open(inbox(8));
    await listOnly(app);

    app.mail.storageData["neoinbox-inbox-cap"] = 8;
    await app.backfill.runBackfill();
    await settle();

    const rows = await inboxRows(app);
    expect(rows.every((m) => m.detailsVersion === MESSAGE_DETAILS_VERSION)).toBe(true);
    expect(rows.every((m) => !m.classifiedIncomplete)).toBe(true);
  });

  it("gets its details when its conversation is opened", async () => {
    app = await open(inbox(8));
    await listOnly(app);
    const lazy = (await inboxRows(app)).find((m) => m.detailsVersion === DETAILS_LAZY)!;

    app.store().hydrateThreadDetails([lazy.key]);
    await settle();

    expect((await app.db.messages.get(lazy.key))?.detailsVersion).toBe(MESSAGE_DETAILS_VERSION);
  });

  it("is left alone by the automatic trip sweep", async () => {
    app = await open(inbox(CAP, [oldBooking(300)]));
    await listOnly(app);
    const bodies = app.mail.calls.getFull.length;
    const { runTripExtraction } = await background();

    await runTripExtraction();
    await settle();

    expect(app.mail.calls.getFull.length).toBe(bodies);
    expect(await app.db.reservations.count()).toBe(0);
  });
});

describe("trips in older inbox mail", () => {
  it("are found by the load from Older mail", async () => {
    app = await open(inbox(CAP, [oldBooking(300)]));
    const { runTripScan } = await background();

    await runTripScan({ archive: true, inboxSince: null });
    await settle();

    expect(app.store().inboxImport).toMatchObject({ running: false, imported: 1 });
    expect(app.store().tripScan).toMatchObject({ running: false, fromInbox: true });
    expect(await app.db.reservations.count()).toBe(1);
  });

  it("are still found after a restart mid-load", async () => {
    app = await open(inbox(CAP, [oldBooking(300)]));
    // What a quit mid-load leaves behind.
    app.mail.storageData["neoinbox-archive-job"] = { kind: "trips", inboxSince: null };
    const { resumeArchiveJob } = await background();

    await resumeArchiveJob();
    await settle();

    expect((await inboxRows(app)).map((m) => m.subject)).toContain("Your booking confirmation KYT8Q2");
    expect(await app.db.reservations.count()).toBe(1);
    expect(app.mail.storageData["neoinbox-archive-job"]).toBeUndefined();
  });
});

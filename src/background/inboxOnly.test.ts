/**
 * NeoInbox operates on the Inbox and nothing else.
 *
 * It writes outside the inbox — Done and Snooze perform a real archive, which
 * is a server-side move — but it never *reads* outside it. That distinction is
 * what these tests pin down, because the folder Thunderbird flags as the
 * archive is All Mail on a Gmail account: enumerating it syncs headers for the
 * entire mailbox, and fetching bodies out of it downloads the entire mailbox.
 *
 * The assertions are deliberately about cost (which folders were enumerated,
 * which messages had bodies fetched) rather than about results, since every
 * regression here looks correct and just quietly downloads a few gigabytes.
 */
import { afterEach, describe, expect, it } from "vitest";
import { boot, type Booted } from "../test/boot";
import {
  ARCHIVE,
  DRAFTS,
  INBOX,
  many,
  personalMail,
  promoMail,
  SENT,
  shapes,
} from "../test/fixtures";
import { settle, type FakeMessengerOptions } from "../test/fakeMessenger";

const open = async (options: FakeMessengerOptions): Promise<Booted> => {
  const app = await boot(options);
  await app.store().init();
  await settle();
  return app;
};

/** Every folder NeoInbox walked end to end, however it asked. */
const enumerated = (app: Booted): Set<string | undefined> =>
  new Set(app.mail.calls.enumeratedFolders);

/**
 * Done is optimistic behind an undo toast — dismissing it is what commits the
 * archive, the same as letting the toast time out.
 */
const commitUndo = async (app: Booted): Promise<void> => {
  app.store().dismissToast(app.store().toasts.at(-1)!.id);
  await settle();
};

let app: Booted | undefined;
afterEach(async () => {
  await app?.db.delete();
  app = undefined;
});

/** Cached rows for a fake message, by the Message-ID the fake gave it. */
const rowsFor = (app: Booted, id: number): Promise<number> =>
  app.db.messages.where("headerMessageId").equals(`<msg-${id}@example.com>`).count();

describe("folders NeoInbox is allowed to read", () => {
  it("never enumerates the archive during a full scan", async () => {
    app = await open(shapes.withArchive(many(6, promoMail), many(40, personalMail)));

    await app.backfill.runBackfill();
    await settle();

    // Sent is reached by a date-windowed query rather than a plain list, so
    // the check spans both ways of enumerating a folder.
    expect(enumerated(app)).toEqual(new Set([INBOX, SENT, DRAFTS]));
  });

  it("never fetches a body for a message that lives in the archive", async () => {
    app = await open(shapes.withArchive(many(4, promoMail), many(30, personalMail)));

    await app.backfill.runBackfill();
    await settle();

    const archivedIds = new Set(app.mail.idsIn(ARCHIVE));
    expect(app.mail.calls.getFull.filter((id) => archivedIds.has(id))).toEqual([]);
  });

  it("ignores mail archived outside NeoInbox instead of ingesting it", async () => {
    app = await open(shapes.withArchive(many(3, promoMail), []));
    await app.backfill.runBackfill();
    await settle();
    const before = app.mail.calls.getFull.length;

    // A message NeoInbox has no row for, archived from Thunderbird's own UI or
    // by another client. Nothing to follow, so nothing should be read.
    const strayId = app.mail.insert(INBOX, personalMail());
    await app.mail.moveTo([strayId], ARCHIVE);
    await settle();

    expect(await rowsFor(app, strayId)).toBe(0);
    expect(app.mail.calls.getFull.length).toBe(before);
  });

  it("ignores mail delivered straight into the archive", async () => {
    app = await open(shapes.withArchive(many(3, promoMail), []));
    await app.backfill.runBackfill();
    await settle();
    const before = app.mail.calls.getFull.length;

    const strayId = await app.mail.deliver(ARCHIVE, personalMail());
    await settle();

    expect(await rowsFor(app, strayId)).toBe(0);
    expect(app.mail.calls.getFull.length).toBe(before);
  });
});

describe("Done still archives for real", () => {
  it("moves the message out of the inbox and records it locally", async () => {
    app = await open(shapes.standard(many(3, promoMail)));
    await app.backfill.runBackfill();
    await settle();

    const target = app.mail.idsIn(INBOX)[0]!;
    app.store().doneThread([app.mail.keyOf(target)]);
    await commitUndo(app);

    // The mail really left the inbox — this is a server-side move, not a flag.
    expect(app.mail.idsIn(INBOX)).not.toContain(target);
    expect(app.mail.idsIn(ARCHIVE)).toHaveLength(1);

    // ...and NeoInbox knows it is done without reading the archive back.
    const done = (await app.db.messages.toArray()).filter((m) => m.origin === "done");
    expect(done).toHaveLength(1);
    // Locating the archived copy is a single Message-ID lookup, not a walk.
    expect(enumerated(app)).not.toContain(ARCHIVE);
    expect(app.mail.calls.pointLookups).toContain(ARCHIVE);
  });
});

describe("snooze without searching the archive", () => {
  it("wakes a snoozed message using the destination it recorded", async () => {
    app = await open(shapes.withArchive(many(2, promoMail), many(25, personalMail)));
    await app.backfill.runBackfill();
    await settle();

    const target = app.mail.keyOf(app.mail.idsIn(INBOX)[0]!);
    app.store().snoozeThread([target], Date.now() + 60_000);
    await settle();

    const record = await app.db.snoozes.get(target);
    expect(record?.archivedFolderId).toBe(ARCHIVE);
    expect(record?.archivedTbId).toBeDefined();

    app.mail.calls.enumeratedFolders.length = 0;
    app.store().unsnoozeThread([target]);
    await settle();

    // Back in the inbox, and the archive was never walked to find it.
    expect(enumerated(app)).not.toContain(ARCHIVE);
    const restored = (await app.db.messages.toArray()).find(
      (m) => m.origin === "inbox" && !m.snoozed,
    );
    expect(restored).toBeDefined();
  });
});

describe("the inbox scan window", () => {
  it("ingests only the newest messages up to the cap", async () => {
    app = await open(shapes.standard(many(12, promoMail)));
    app.mail.storageData["neoinbox-inbox-cap"] = 5;

    await app.backfill.runBackfill();
    await settle();

    const cached = (await app.db.messages.toArray()).filter((m) => m.origin === "inbox");
    expect(cached).toHaveLength(5);

    // The newest five specifically, not an arbitrary five. `many` dates each
    // message a minute after the last, so the highest ids are the newest.
    const newestIds = app.mail.idsIn(INBOX).slice(-5);
    expect(cached.map((m) => m.tbId).sort((a, b) => a - b)).toEqual(newestIds);
  });

  it("reports how many older messages are waiting", async () => {
    app = await open(shapes.standard(many(12, promoMail)));
    app.mail.storageData["neoinbox-inbox-cap"] = 5;

    await app.backfill.runBackfill();
    await settle();

    expect(app.store().inboxWindow).toEqual({ cap: 5, skipped: 7 });
  });

  it("widens the window on load-more and keeps the rest of the inbox", async () => {
    app = await open(shapes.standard(many(12, promoMail)));
    app.mail.storageData["neoinbox-inbox-cap"] = 5;
    await app.backfill.runBackfill();
    await settle();

    const widened = await app.backfill.raiseInboxScanCap();
    expect(widened).toBe(5 + app.backfill.INBOX_SCAN_STEP);

    await app.backfill.runBackfill();
    await settle();

    const cached = (await app.db.messages.toArray()).filter((m) => m.origin === "inbox");
    expect(cached).toHaveLength(12);
    expect(app.store().inboxWindow).toEqual({ cap: widened, skipped: 0 });
  });

  it("leaves incremental sync uncapped so new mail always lands", async () => {
    app = await open(shapes.standard(many(4, promoMail)));
    app.mail.storageData["neoinbox-inbox-cap"] = 2;
    await app.backfill.runBackfill();
    await settle();
    expect((await app.db.messages.toArray()).filter((m) => m.origin === "inbox"))
      .toHaveLength(2);

    const fresh = app.mail.insert(INBOX, promoMail({ date: Date.now() }));
    await app.backfill.runIncrementalSync();
    await settle();

    expect(await app.db.messages.get(app.mail.keyOf(fresh))).toBeDefined();
  });
});

/**
 * Thunderbird pages event payloads like it pages list(): `messages` is the
 * first page and `id` leads to the rest. These pin down that no listener
 * stops at the first page.
 */
describe("event lists longer than a page", () => {
  const inboxRows = async (app: Booted) =>
    (await app.db.messages.toArray()).filter((m) => m.origin === "inbox");

  it("takes a big arrival through the inbox window, newest first", async () => {
    app = await open(shapes.paginated([], 3));
    app.mail.storageData["neoinbox-inbox-cap"] = 5;
    await app.backfill.runBackfill();
    await settle();

    const ids = await app.mail.deliverMany(INBOX, many(12, promoMail));
    await settle();

    // The newest five of the twelve, not the first page of three.
    const cached = await inboxRows(app);
    expect(cached.map((m) => m.tbId).sort((a, b) => a - b)).toEqual(ids.slice(-5));
    expect(app.store().inboxWindow).toEqual({ cap: 5, skipped: 7 });
  });

  it("caches every page of an arrival that fits the window", async () => {
    app = await open(shapes.paginated([], 3));
    await app.backfill.runBackfill();
    await settle();

    await app.mail.deliverMany(INBOX, many(8, promoMail));
    await settle();

    expect(await inboxRows(app)).toHaveLength(8);
  });

  it("removes every page of a bulk delete", async () => {
    app = await open(shapes.paginated(many(8, promoMail), 3));
    await app.backfill.runBackfill();
    await settle();
    expect(await inboxRows(app)).toHaveLength(8);

    await app.mail.messagesApi.delete(app.mail.idsIn(INBOX));
    await settle();

    expect(await inboxRows(app)).toHaveLength(0);
  });
});

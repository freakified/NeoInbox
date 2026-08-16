/**
 * Regression tests for the classification bugs that made a long-idle NeoInbox
 * need a manual "Reclassify inbox". Each one drives the real background
 * modules against the fake messenger — no Thunderbird involved.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { boot, type Booted } from "../test/boot";
import { ARCHIVE, categoriesOf, forumMail, INBOX, many, personalMail, promoMail, SENT, shapes } from "../test/fixtures";
import { CLASSIFIER_VERSION } from "../classifier/version";
import { settle, type FakeMessengerOptions } from "../test/fakeMessenger";
import type { RawMessage } from "../shared/types";

const cachedRow = (over: Partial<RawMessage> = {}): RawMessage => ({
  id: 1,
  headerMessageId: "<msg-1@example.com>",
  subject: "",
  author: "",
  recipients: [],
  ccList: [],
  bccList: [],
  date: 0,
  size: 1024,
  read: false,
  folderId: INBOX,
  accountId: "a",
  tags: [],
  category: null,
  pinned: false,
  snoozed: false,
  origin: "inbox",
  ...over,
});

/** Marks every cached row as classified under older rules. */
const markOutdated = (app: Booted) =>
  app.db.messages.toCollection().modify((m) => {
    m.classifierVersion = CLASSIFIER_VERSION - 1;
  });

const open = (options: FakeMessengerOptions): Promise<Booted> => boot(options);

afterEach(() => vi.useRealTimers());

describe("full scan classification", () => {
  const threeMessages = () =>
    open(shapes.standard([forumMail(), promoMail(), personalMail()]));

  it("classifies mail it has never seen", async () => {
    const app = await threeMessages();

    const counters = await app.backfill.runBackfill();

    expect(counters.scanned).toBe(3);
    expect(counters.reclassified).toBe(3);
    expect(await categoriesOf(app.db)).toEqual({ forums: 1, promos: 1, none: 1 });
  });

  it("does not re-run the pipeline for rows already on the current version", async () => {
    const app = await threeMessages();
    await app.backfill.runBackfill();

    const second = await app.backfill.runBackfill();

    // The signal that used to be ambiguous: 0 ran the classifier because
    // everything was current, not because the scan skipped work it owed.
    expect(second.scanned).toBe(3);
    expect(second.reclassified).toBe(0);
  });

  it("re-runs the pipeline for rows stamped with an older classifier version", async () => {
    const app = await threeMessages();
    await app.backfill.runBackfill();
    await markOutdated(app);

    const third = await app.backfill.runBackfill();

    expect(third.reclassified).toBe(3);
    const rows = await app.db.messages.toArray();
    expect(rows.every((m) => m.classifierVersion === CLASSIFIER_VERSION)).toBe(true);
  });

  it("applies a rules change to mail that is already cached", async () => {
    // The end-to-end shape of the original bug: a cached row holding a stale
    // category must not survive a scan just because its headers didn't change.
    const app = await threeMessages();
    await app.backfill.runBackfill();
    await app.db.messages.toCollection().modify((m) => {
      m.category = "finance";
      m.classifierVersion = CLASSIFIER_VERSION - 1;
    });

    await app.backfill.runBackfill();

    expect(await categoriesOf(app.db)).toEqual({ forums: 1, promos: 1, none: 1 });
  });

  it("handles folder roles declared with the deprecated type field", async () => {
    const app = await open(shapes.legacyFolderRoles([promoMail()]));

    const counters = await app.backfill.runBackfill();

    expect(counters.scanned).toBe(1);
    expect(await categoriesOf(app.db)).toEqual({ promos: 1 });
  });

  it("walks a folder large enough to need pagination", async () => {
    const app = await open(shapes.paginated(many(25, promoMail), 10));

    const counters = await app.backfill.runBackfill();

    expect(counters.scanned).toBe(25);
    expect(await categoriesOf(app.db)).toEqual({ promos: 25 });
  });

  it("scans every account", async () => {
    const app = await open(shapes.multiAccount([promoMail()], [forumMail(), promoMail()]));

    await app.backfill.runBackfill();

    expect(await categoriesOf(app.db)).toEqual({ promos: 2, forums: 1 });
  });
});

describe("classification without a downloaded body", () => {
  // promoMail depends on its List-Unsubscribe header, so losing getFull loses
  // the category. (forumMail would still match on its googlegroups.com domain.)
  it("records a header-only result as incomplete instead of a settled category", async () => {
    const app = await open(shapes.standard([promoMail({ bodyUnavailable: true })]));

    await app.backfill.runBackfill();

    const [row] = await app.db.messages.toArray();
    expect(row!.category).toBeNull();
    expect(row!.classifiedIncomplete).toBe(true);
  });

  it("repairs the category once the body becomes available", async () => {
    const app = await open(shapes.standard([promoMail({ id: 1, bodyUnavailable: true })]));
    await app.backfill.runBackfill();
    expect((await app.db.messages.get(1))!.category).toBeNull();

    app.mail.insert(INBOX, promoMail({ id: 1 })); // IMAP catches up
    await app.backfill.retryIncompleteClassifications();

    const row = await app.db.messages.get(1);
    expect(row!.category).toBe("promos");
    expect(row!.classifiedIncomplete).toBe(false);
  });

  it("retries without needing a scan to run", async () => {
    // The bug: repair only ever happened in runScan's finally, so no scan
    // meant no repair. It stands alone now that it has its own alarm.
    const app = await open(shapes.standard([promoMail({ id: 1 })]));
    await app.db.messages.put(cachedRow({ classifiedIncomplete: true }));

    await app.backfill.retryIncompleteClassifications();

    expect((await app.db.messages.get(1))!.category).toBe("promos");
  });

  it("leaves the row flagged while the body is still missing", async () => {
    const app = await open(shapes.standard([promoMail({ id: 1, bodyUnavailable: true })]));
    await app.db.messages.put(cachedRow({ classifiedIncomplete: true }));

    await app.backfill.retryIncompleteClassifications();

    const row = await app.db.messages.get(1);
    expect(row!.classifiedIncomplete).toBe(true);
    expect(row!.category).toBeNull();
  });
});

describe("a scan that fails partway", () => {
  it("releases the queue flag so later syncs still run", async () => {
    // The wedge: the flag is cleared in the scan's finally, so anything that
    // stops the scan from settling silently disables every later sync.
    const app = await open(shapes.standard(many(4, forumMail)));
    app.mail.fail("list", "IMAP connection dropped");

    await app.backfill.runBackfill();
    expect(await app.db.messages.count()).toBe(0);

    app.mail.unfail("list");
    await app.backfill.runIncrementalSync();

    expect(await app.db.messages.count()).toBe(4);
  });
});

describe("withTimeout", () => {
  it("rejects a call that never settles, so a stalled folder op can't hang the chain", async () => {
    const app = await open(shapes.standard());
    vi.useFakeTimers();

    const rejects = expect(
      app.backfill.withTimeout(new Promise(() => {}), "list folder inbox-a", 60_000),
    ).rejects.toThrow("list folder inbox-a timed out after 60000ms");
    await vi.advanceTimersByTimeAsync(60_001);

    await rejects;
  });

  it("passes a value straight through when the call settles in time", async () => {
    const app = await open(shapes.standard());
    await expect(app.backfill.withTimeout(Promise.resolve(7), "quick", 1_000)).resolves.toBe(7);
  });
});

describe("classifier version sweep", () => {
  const twelveMessages = async (): Promise<Booted> => {
    const app = await open(shapes.standard(many(12, promoMail)));
    await app.backfill.runBackfill();
    await app.db.messages.toCollection().modify((m) => {
      m.classifierVersion = 0;
      m.category = null;
    });
    return app;
  };

  it("reclassifies every outdated cached row", async () => {
    const app = await twelveMessages();

    const result = await app.backfill.runClassifierVersionSweep();

    expect(result).toEqual({ scanned: 12, moved: 12, remaining: 0 });
    expect(await categoriesOf(app.db)).toEqual({ promos: 12 });
  });

  it("stores the version once nothing outdated is left", async () => {
    const app = await twelveMessages();

    await app.backfill.runClassifierVersionSweep();

    expect(app.mail.storageData["neoinbox-classifier-version"]).toBe(CLASSIFIER_VERSION);
  });

  it("does no work when the stored version already matches", async () => {
    const app = await open(shapes.standard(many(12, promoMail)));
    await app.backfill.runBackfill();
    app.mail.storageData["neoinbox-classifier-version"] = CLASSIFIER_VERSION;

    const result = await app.backfill.runClassifierVersionSweep();

    expect(result).toEqual({ scanned: 0, moved: 0, remaining: 0 });
  });
});

describe("classifier version sweep across chunk boundaries", () => {
  // The real archive backlog runs to tens of thousands of rows, so the sweep
  // has to chunk. These cover the properties that make it safe to interrupt.
  const TOTAL = 520; // one full chunk of 500, plus a remainder

  const bigBacklog = async (): Promise<Booted> => {
    const app = await open(shapes.standard(many(TOTAL, promoMail)));
    await app.backfill.runBackfill();
    await app.db.messages.toCollection().modify((m) => {
      m.classifierVersion = 0;
      m.category = null;
    });
    return app;
  };

  it("stops at the chunk size and reports the remainder", async () => {
    const app = await bigBacklog();

    const pass = await app.backfill.runClassifierVersionSweep();

    expect(pass.scanned).toBe(500);
    expect(pass.remaining).toBe(TOTAL - 500);
  });

  it("does not claim the version while rows are still outdated", async () => {
    const app = await bigBacklog();

    await app.backfill.runClassifierVersionSweep();

    // Interrupting here (closing Thunderbird) must not look like completion,
    // or the remaining rows would stay stranded on the old rules forever.
    expect(app.mail.storageData["neoinbox-classifier-version"]).toBeUndefined();
  });

  it("resumes from where it stopped rather than restarting", async () => {
    const app = await bigBacklog();
    await app.backfill.runClassifierVersionSweep();

    const second = await app.backfill.runClassifierVersionSweep();

    // 20 left, not 520: the first pass's work survived.
    expect(second.scanned).toBe(TOTAL - 500);
    expect(second.remaining).toBe(0);
    expect(app.mail.storageData["neoinbox-classifier-version"]).toBe(CLASSIFIER_VERSION);
    expect(await categoriesOf(app.db)).toEqual({ promos: TOTAL });
  });

  it("sorts inbox rows ahead of archived ones so the visible inbox lands first", async () => {
    const app = await bigBacklog();
    await app.db.messages.toCollection().modify((m) => {
      if (m.id % 2 === 0) m.origin = "done";
    });

    await app.backfill.runClassifierVersionSweep();

    const stillOutdated = (await app.db.messages.toArray()).filter(
      (m) => (m.classifierVersion ?? 0) < CLASSIFIER_VERSION,
    );
    expect(stillOutdated.every((m) => m.origin === "done")).toBe(true);
  });
});

describe("version sweep when Thunderbird has renumbered the cache", () => {
  // The live failure this guards: a mailbox whose archived rows all carry
  // drifted ids. Each one can only be found again by a Message-ID search that
  // walks the account, so an unrationed sweep spends a second per row for
  // hours, flooding the log and starving the UI.
  const remapped = async (count: number): Promise<Booted> => {
    const app = await open(shapes.standard(many(count, promoMail)));
    await app.backfill.runBackfill();
    app.mail.remapIds();
    await app.db.messages.toCollection().modify((m) => {
      m.classifierVersion = 0;
    });
    app.mail.calls.query = 0;
    return app;
  };

  it("rations the expensive Message-ID searches per pass", async () => {
    const app = await remapped(40);

    const pass = await app.backfill.runClassifierVersionSweep();

    // 25 resolved, the rest deferred to a later pass rather than searched now.
    expect(app.mail.calls.query).toBe(25);
    expect(pass.scanned).toBe(25);
    expect(pass.remaining).toBe(15);
  });

  it("re-keys resolved rows so the search is never paid twice", async () => {
    const app = await remapped(40);

    await app.backfill.runClassifierVersionSweep();

    // Rows that resolved now sit under their live ids; nothing still points at
    // an id Thunderbird no longer has.
    const rows = await app.db.messages.toArray();
    const live = new Set(app.mail.idsIn(INBOX));
    const stamped = rows.filter((m) => m.classifierVersion === CLASSIFIER_VERSION);
    expect(stamped).toHaveLength(25);
    expect(stamped.every((m) => live.has(m.id))).toBe(true);
  });

  it("drains across passes without re-searching what it already fixed", async () => {
    const app = await remapped(40);

    await app.backfill.runClassifierVersionSweep();
    const second = await app.backfill.runClassifierVersionSweep();

    expect(second.remaining).toBe(0);
    // 40 searches total, not 40 per pass.
    expect(app.mail.calls.query).toBe(40);
    expect(app.mail.storageData["neoinbox-classifier-version"]).toBe(CLASSIFIER_VERSION);
  });

  it("retires rows whose message is gone instead of retrying them forever", async () => {
    // Without this the sweep livelocks: an unresolvable row stays outdated, so
    // it leads every later pass, burns the budget and never drains.
    const app = await open(shapes.standard(many(5, promoMail)));
    await app.backfill.runBackfill();
    // Strand the rows without deleting them: the numeric ids no longer exist
    // and the Message-IDs match nothing, so resolution genuinely fails. (Going
    // through the fake's delete would fire onDeleted and drop the cached rows,
    // leaving nothing to sweep.)
    app.mail.remapIds();
    await app.db.messages.toCollection().modify((m) => {
      m.classifierVersion = 0;
      m.headerMessageId = `<vanished-${m.id}@nowhere.example>`;
    });

    const pass = await app.backfill.runClassifierVersionSweep();

    const rows = await app.db.messages.toArray();
    expect(rows).toHaveLength(5);
    expect(rows.every((m) => m.classifierVersion === CLASSIFIER_VERSION)).toBe(true);
    expect(pass.remaining).toBe(0);
  });

  it("keeps the old category on a row it could not find", async () => {
    const app = await open(shapes.standard(many(3, promoMail)));
    await app.backfill.runBackfill();
    app.mail.remapIds();
    await app.db.messages.toCollection().modify((m) => {
      m.classifierVersion = 0;
      m.headerMessageId = `<vanished-${m.id}@nowhere.example>`;
    });

    await app.backfill.runClassifierVersionSweep();

    // Retiring a row must not blank its bundle — it just stops being retried.
    const rows = await app.db.messages.toArray();
    expect(rows.map((m) => m.category)).toEqual(["promos", "promos", "promos"]);
  });
});

/**
 * A scan's cost is dominated by per-message round trips, not by the rules
 * engine. These pin the round trips down: correctness tests above stay green
 * whether a message is fetched once or three times, so nothing else notices a
 * regression here until a real mailbox chugs.
 *
 * runBackfill kicks off details hydration detached, so every case settles
 * rather than awaiting it directly — the in-flight guard would make a second
 * call return immediately and read the cache mid-write.
 */
describe("per-message fetch cost of a scan", () => {
  it("fetches each inbox message's body once, not once per consumer", async () => {
    // The classifier wants List-* headers and the details extractor wants
    // References/In-Reply-To — both out of the same getFull.
    const app = await open(shapes.standard(many(10, promoMail)));

    await app.backfill.runBackfill();
    await settle();

    const { getFull } = app.mail.calls;
    expect(getFull).toHaveLength(10);
    expect(new Set(getFull).size).toBe(10);
  });

  it("does not refetch bodies on a rescan that reclassifies nothing", async () => {
    const app = await open(shapes.standard(many(10, promoMail)));
    await app.backfill.runBackfill();
    await settle();
    app.mail.calls.getFull.length = 0;

    await app.backfill.runIncrementalSync();
    await settle();

    expect(app.mail.calls.getFull).toHaveLength(0);
  });

  it("skips listAttachments for sent mail, whose attachments are discarded", async () => {
    const app = await open(shapes.withSent(many(4, promoMail), many(6, personalMail)));

    await app.backfill.runBackfill();
    await settle();

    // Sent rows are threading material only; the inbox still lists its own.
    const sentIds = new Set(app.mail.idsIn(SENT));
    expect(app.mail.calls.listAttachments.some((id) => sentIds.has(id))).toBe(false);
    expect(new Set(app.mail.calls.listAttachments)).toEqual(
      new Set(app.mail.idsIn(INBOX)),
    );
  });

  it("does not fetch sent bodies during a scan", async () => {
    const app = await open(shapes.withSent(many(2, promoMail), many(6, personalMail)));

    await app.backfill.runBackfill();
    await settle();

    // Sent rows are cached from their headers alone. Fetching References for
    // them costs a body each, and a year of Sent is a lot of bodies — they are
    // hydrated on demand instead, when a conversation is opened.
    const sentIds = new Set(app.mail.idsIn(SENT));
    expect(app.mail.calls.getFull.some((id) => sentIds.has(id))).toBe(false);
  });

  it("threads sent mail into its conversation once the thread is opened", async () => {
    const app = await open(
      shapes.withSent(
        [personalMail({ headerMessageId: "<root@example.com>" })],
        [
          personalMail({
            subject: "Re: Lunch on Thursday",
            headers: { References: ["<root@example.com>"] },
          }),
        ],
      ),
    );

    await app.backfill.runBackfill();
    await settle();

    const sentId = app.mail.idsIn(SENT)[0]!;
    expect((await app.db.messages.get(sentId))?.references).toEqual([]);

    await app.backfill.hydrateDetails([sentId]);
    await settle();

    expect((await app.db.messages.get(sentId))?.references).toEqual([
      "root@example.com",
    ]);
  });
});

/**
 * The scan's bookkeeping paths: drift detection and the stranded-row prune.
 * Both were rewritten to work off indexes instead of reading the whole cache,
 * and neither had coverage — a prune that quietly ate archived mail, or a
 * drift check that fired on every sync, would both have looked like a pass.
 */
describe("drift detection", () => {
  it("re-scans a folder in full when the cached count disagrees", async () => {
    const app = await open(shapes.standard(many(3, promoMail)));
    await app.backfill.runBackfill();

    // Lands with no event and dated behind the cursor, so an incremental query
    // looks straight past it. Only the count mismatch can reveal it.
    app.mail.insert(INBOX, promoMail({ date: new Date(Date.now() - 90 * 86_400_000) }));

    await app.backfill.runIncrementalSync();

    expect(await app.db.messages.count()).toBe(4);
  });

  it("stays incremental when the cached count matches", async () => {
    const app = await open(shapes.standard(many(3, promoMail)));
    await app.backfill.runBackfill();
    app.mail.calls.list = 0;

    await app.backfill.runIncrementalSync();

    // list() is the wholesale folder read; an incremental sweep uses query().
    expect(app.mail.calls.list).toBe(0);
  });

  it("does not read a snoozed row as drift", async () => {
    const app = await open(shapes.standard(many(3, promoMail)));
    await app.backfill.runBackfill();

    // Snoozing archives the message, so it leaves the inbox while the cached
    // row still carries the old folder. Counting that row would show the cache
    // one ahead of the mailbox and force a full rescan on every single sync.
    const [first] = await app.db.messages.toArray();
    await app.db.messages.put({ ...first!, snoozed: true });
    await app.db.snoozes.put({
      messageId: first!.id,
      headerMessageId: first!.headerMessageId,
      wakeAt: Date.now() + 86_400_000,
      originFolderId: INBOX,
      originAccountId: "a",
    });
    app.mail.remove(first!.id);
    app.mail.calls.list = 0;

    await app.backfill.runIncrementalSync();

    expect(app.mail.calls.list).toBe(0);
  });
});

describe("pruning rows from folders that lost their role", () => {
  it("drops rows stranded in an unscanned folder", async () => {
    const app = await open(shapes.standard(many(2, promoMail)));
    await app.backfill.runBackfill();
    await app.db.messages.put(cachedRow({ id: 9001, folderId: "a-folder-we-no-longer-scan" }));

    await app.backfill.runBackfill();

    expect(await app.db.messages.get(9001)).toBeUndefined();
  });

  it("keeps archived rows, which live outside the scanned folders by design", async () => {
    const app = await open(shapes.standard(many(2, promoMail)));
    await app.backfill.runBackfill();
    await app.db.messages.put(cachedRow({ id: 9002, folderId: ARCHIVE, origin: "done" }));

    await app.backfill.runBackfill();

    expect(await app.db.messages.get(9002)).toBeDefined();
  });

  it("keeps snoozed rows, which are archived but still ours", async () => {
    const app = await open(shapes.standard(many(2, promoMail)));
    await app.backfill.runBackfill();
    await app.db.messages.put(
      cachedRow({ id: 9003, folderId: ARCHIVE, origin: "inbox", snoozed: true }),
    );

    await app.backfill.runBackfill();

    expect(await app.db.messages.get(9003)).toBeDefined();
  });
});

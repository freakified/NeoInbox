/**
 * Full-loop tests: fake messenger -> real background -> a linked port pair ->
 * the real SPA store -> real stream derivation, all in one process.
 *
 * This is the layer that catches the two halves disagreeing — an optimistic row
 * the background never confirms, a delta the store drops, a category that never
 * reaches the bundle it belongs in.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { settle, waitFor } from "./fakeMessenger";
import { boot, type Booted } from "./boot";
import {
  ARCHIVE,
  INBOX,
  forumMail,
  headerOnlyPromoMail,
  personalMail,
  promoMail,
  shapes,
} from "./fixtures";
import { messageKeyOf } from "../shared/messageKey";
import type { RawMessage } from "../shared/types";
import type { StreamItem } from "../store/stream";

/** The inbox as the SPA would render it. */
const inboxItems = (app: Booted): StreamItem[] =>
  app
    .deriveStream(app.store().messagesByKey, app.store().myEmails, { type: "inbox" })
    .sections.flatMap((s) => s.items);

const bundleFor = (app: Booted, category: string): StreamItem | undefined =>
  inboxItems(app).find((i) => i.type === "bundle" && i.category === category);

const looseThreads = (app: Booted): StreamItem[] =>
  inboxItems(app).filter((i) => i.type === "thread");

/**
 * Commits the command an undo toast is holding, the way dismissing the toast
 * does. Deliberately not by advancing fake timers: the command handler awaits
 * Dexie, and swapping back to real timers mid-transaction discards the pending
 * IndexedDB callbacks, leaving the handler stuck forever. mailStore.test.ts
 * covers the timeout itself, where no database work follows.
 */
const commitPendingAction = async (app: Booted): Promise<void> => {
  app.store().dismissToast(app.store().toasts.at(-1)!.id);
  await settle();
};

const open = async (options = shapes.standard()): Promise<Booted> => {
  const app = await boot(options);
  await app.store().init();
  await settle();
  return app;
};

afterEach(() => vi.useRealTimers());

/** The store's row for a fake message, wherever it has moved since. */
const rowFor = (app: Booted, id: number): RawMessage | undefined =>
  Object.values(app.store().messagesByKey).find(
    (m) => m.headerMessageId === `<msg-${id}@example.com>`,
  );

describe("new mail arriving", () => {
  it("classifies it and lands it in the right bundle on screen", async () => {
    const app = await open();
    await app.mail.deliver(INBOX, promoMail());
    await app.mail.deliver(INBOX, promoMail());
    await app.mail.deliver(INBOX, personalMail());
    await settle();

    const promos = bundleFor(app, "promos");
    expect(promos && promos.type === "bundle" && promos.threads).toHaveLength(2);
    // The uncategorised one stays loose rather than joining a bundle.
    expect(looseThreads(app)).toHaveLength(1);
  });

  it("leaves mail whose body has not synced loose, then bundles it on repair", async () => {
    // The exact shape of the original complaint: a backlog arrives with no
    // bodies, classification falls back to headers, and rows land loose.
    const app = await open();
    const id = await app.mail.deliver(INBOX, headerOnlyPromoMail({ bodyUnavailable: true }));
    await settle();

    expect(bundleFor(app, "promos")).toBeUndefined();
    expect(looseThreads(app)).toHaveLength(1);

    app.mail.insert(INBOX, headerOnlyPromoMail({ id })); // IMAP catches up
    await app.backfill.retryIncompleteClassifications();
    await settle();

    expect(bundleFor(app, "promos")).toBeDefined();
  });

  it("keeps two accounts' mail apart", async () => {
    const app = await open(shapes.multiAccount());
    await app.mail.deliver("inbox-a", promoMail());
    await app.mail.deliver("inbox-b", promoMail());
    await settle();

    const promos = bundleFor(app, "promos");
    // Same category, same shape, but two accounts means two threads.
    expect(promos && promos.type === "bundle" && promos.threads).toHaveLength(2);
  });
});

describe("archiving a thread", () => {
  it("removes it from the inbox and moves the message to Archives", async () => {
    const app = await open();
    const id = await app.mail.deliver(INBOX, forumMail());
    await settle();

    app.store().doneThread([app.mail.keyOf(id)]);

    // Optimistic: gone from the inbox before the archive round-trip.
    expect(inboxItems(app)).toHaveLength(0);
    expect(app.mail.folderOf(id)).toBe(INBOX);

    await commitPendingAction(app);

    // The move gave it a new id, as Thunderbird does; the row followed it.
    expect(app.mail.idsIn(INBOX)).toEqual([]);
    expect(app.mail.idsIn(ARCHIVE)).toHaveLength(1);
    expect(rowFor(app, id)?.origin).toBe("done");
    expect(rowFor(app, id)?.folderId).toBe(ARCHIVE);
    expect(inboxItems(app)).toHaveLength(0);
  });

  it("keeps it in its bundle view after archiving", async () => {
    const app = await open();
    const id = await app.mail.deliver(INBOX, forumMail());
    await settle();

    app.store().doneThread([app.mail.keyOf(id)]);
    await commitPendingAction(app);

    const bundle = app.deriveStream(app.store().messagesByKey, app.store().myEmails, {
      type: "bundle",
      category: "forums",
    });
    expect(bundle.threadCount).toBe(1);
  });

  it("undo keeps the message exactly where it was", async () => {
    const app = await open();
    const id = await app.mail.deliver(INBOX, forumMail());
    await settle();

    app.store().doneThread([app.mail.keyOf(id)]);
    app.store().undoToast(app.store().toasts.at(-1)!.id);
    await settle();

    expect(inboxItems(app)).toHaveLength(1);
    expect(app.mail.folderOf(id)).toBe(INBOX);
  });

  it("rolls the row back into the inbox when there is no Archives folder", async () => {
    const app = await open(shapes.noArchive());
    const id = await app.mail.deliver(INBOX, forumMail());
    await settle();

    app.store().doneThread([app.mail.keyOf(id)]);
    await commitPendingAction(app);

    // doneMessage retries on a ladder of sleeps before declaring failure, so
    // the rollback lands seconds later rather than on the next turn.
    await waitFor(
      () => rowFor(app, id)?.origin === "inbox",
      "archive failure to roll back",
    );

    // The failure has to reach the UI rather than strand the row in a done
    // state the mail store never actually reached.
    expect(app.mail.folderOf(id)).toBe(INBOX);
    expect(inboxItems(app)).toHaveLength(1);
    expect(app.store().toasts.at(-1)?.message).toContain("Archives");
  });
});

describe("moving archived mail back to the inbox", () => {
  /** Done, then moved back to the inbox, as un-done does. */
  const archiveAndRestore = async (app: Booted, id: number): Promise<void> => {
    app.store().doneThread([app.mail.keyOf(id)]);
    await commitPendingAction(app);
    app.store().moveToInboxThread([rowFor(app, id)!.key]);
    await settle();
  };

  it("can be archived again on Gmail, where All Mail keeps its copy", async () => {
    const app = await open(shapes.gmail());
    // An IMAP move whose destination hasn't synced yet hands nothing back.
    app.mail.withholdMoveResults = true;
    const id = await app.mail.deliver(INBOX, forumMail());
    await settle();

    await archiveAndRestore(app, id);

    // The label was added, not moved: one copy in each folder.
    expect(app.mail.idsIn(INBOX)).toHaveLength(1);
    expect(app.mail.idsIn(ARCHIVE)).toHaveLength(1);
    // The inbox row must be the Inbox copy, never the All Mail one.
    const rows = Object.values(app.store().messagesByKey);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ origin: "inbox", folderId: INBOX });

    app.store().doneThread([rows[0]!.key]);
    await commitPendingAction(app);

    expect(app.mail.idsIn(INBOX)).toEqual([]);
    expect(app.mail.idsIn(ARCHIVE)).toHaveLength(1);
    expect(rowFor(app, id)).toMatchObject({ origin: "done", folderId: ARCHIVE });
  });

  it("repairs an inbox row already cached from the All Mail copy", async () => {
    // The state the Gmail bug above left behind before it was fixed.
    const app = await open(shapes.gmail());
    const id = await app.mail.deliver(INBOX, forumMail());
    await settle();
    const row = rowFor(app, id)!;
    const allMailId = app.mail.insert(ARCHIVE, { headerMessageId: row.headerMessageId });
    const stuck = { ...row, tbId: allMailId, folderId: ARCHIVE };
    stuck.key = messageKeyOf(stuck);
    await app.db.messages.delete(row.key);
    await app.db.messages.put(stuck);
    await app.store().init();
    await settle();

    app.store().doneThread([stuck.key]);
    await commitPendingAction(app);

    expect(app.mail.idsIn(INBOX)).toEqual([]);
    expect(app.mail.idsIn(ARCHIVE)).toEqual([allMailId]);
    expect(rowFor(app, id)).toMatchObject({ origin: "done", folderId: ARCHIVE });
    expect(app.store().toasts.some((t) => /Archives/.test(t.message))).toBe(false);
  });

  it("can be archived again on plain IMAP when the move hands nothing back", async () => {
    const app = await open();
    app.mail.withholdMoveResults = true;
    const id = await app.mail.deliver(INBOX, forumMail());
    await settle();

    await archiveAndRestore(app, id);

    expect(app.mail.idsIn(ARCHIVE)).toEqual([]);
    const rows = Object.values(app.store().messagesByKey);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ origin: "inbox", folderId: INBOX });

    app.store().doneThread([rows[0]!.key]);
    await commitPendingAction(app);

    expect(app.mail.idsIn(INBOX)).toEqual([]);
    expect(rowFor(app, id)).toMatchObject({ origin: "done", folderId: ARCHIVE });
  });
});

describe("pinning", () => {
  it("surfaces a pinned message out of its bundle and persists across a reload", async () => {
    const app = await open();
    const a = await app.mail.deliver(INBOX, promoMail());
    await app.mail.deliver(INBOX, promoMail());
    await settle();

    expect(bundleFor(app, "promos")).toBeDefined();

    app.store().pin(app.mail.keyOf(a), true);
    await settle();

    // One pinned row surfaced, one left in the bundle.
    expect(looseThreads(app)).toHaveLength(1);
    expect(bundleFor(app, "promos")).toBeDefined();

    // A reload rebuilds purely from Dexie; the pin must survive it.
    app.useMailStore.setState({ messagesByKey: {}, hydrated: false });
    await app.store().init();
    await settle();
    expect(app.store().messagesByKey[app.mail.keyOf(a)]?.pinned).toBe(true);
  });
});

describe("reclassify from the UI", () => {
  it("applies a rules change to mail already on screen", async () => {
    const app = await open();
    const id = await app.mail.deliver(INBOX, promoMail());
    await settle();

    // Stand in for a rules change: the cached row holds a category the current
    // rules would not produce, stamped with an older classifier version.
    await app.db.messages.update(app.mail.keyOf(id), { category: "finance", classifierVersion: 0 });
    app.useMailStore.setState({ messagesByKey: {}, hydrated: false });
    await app.store().init();
    await settle();
    expect(bundleFor(app, "finance")).toBeDefined();

    app.store().reclassify();
    await settle();

    expect(bundleFor(app, "finance")).toBeUndefined();
    expect(bundleFor(app, "promos")).toBeDefined();
    expect(app.store().reclassifying).toBe(false);
  });

  it("recovers when Thunderbird has renumbered the messages", async () => {
    const app = await open();
    await app.mail.deliver(INBOX, promoMail());
    await settle();

    // A rebuilt folder database: same mail, all new numeric ids. The cached
    // rows now point at nothing, which used to fail with "Message not found"
    // and leave the stale category in place.
    app.mail.remapIds();
    await app.db.messages.toCollection().modify((m) => {
      m.category = null;
      m.classifierVersion = 0;
    });
    app.useMailStore.setState({ messagesByKey: {}, hydrated: false });
    await app.store().init();
    await settle();

    app.store().reclassify();
    await settle();

    expect(bundleFor(app, "promos")).toBeDefined();
  });
});

describe("a scan finding mail that arrived while the app was closed", () => {
  it("classifies the backlog and shows it bundled", async () => {
    const backlog = [promoMail(), promoMail(), forumMail(), personalMail()];
    const app = await boot(shapes.standard(backlog));

    await app.backfill.runBackfill();
    await app.store().init();
    await settle();

    const promos = bundleFor(app, "promos");
    expect(promos && promos.type === "bundle" && promos.threads).toHaveLength(2);
    expect(bundleFor(app, "forums")).toBeDefined();
    expect(looseThreads(app)).toHaveLength(1);
  });

  it("works when folder roles come from the deprecated type field", async () => {
    const app = await boot(shapes.legacyFolderRoles([promoMail()]));

    await app.backfill.runBackfill();
    await app.store().init();
    await settle();

    expect(bundleFor(app, "promos")).toBeDefined();
  });

  it("walks a folder large enough to paginate", async () => {
    const many = Array.from({ length: 25 }, () => promoMail());
    const app = await boot(shapes.paginated(many, 10));

    await app.backfill.runBackfill();
    await app.store().init();
    await settle();

    const promos = bundleFor(app, "promos");
    expect(promos && promos.type === "bundle" && promos.threads).toHaveLength(25);
  });
});

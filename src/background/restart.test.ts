/**
 * Thunderbird hands out message ids afresh every session, so after a restart
 * an id cached in the last one can name a different message. The cache used
 * to be keyed by those ids: a new inbox message given id 1 overwrote the
 * archived row cached as 1, which then vanished from its trip (and an action
 * on a row could land on someone else's message). Rows are keyed by folder
 * and Message-ID now; these pin that down.
 */
import { afterEach, describe, expect, it } from "vitest";
import { boot, type Booted } from "../test/boot";
import { ARCHIVE, INBOX, many, personalMail, promoMail, shapes } from "../test/fixtures";
import { settle } from "../test/fakeMessenger";

let app: Booted | undefined;
afterEach(async () => {
  await app?.db.delete();
  app = undefined;
});

const open = async (): Promise<Booted> => {
  const booted = await boot(shapes.withArchive(many(3, promoMail), []));
  await booted.store().init();
  await booted.backfill.runBackfill();
  await settle();
  return booted;
};

/** Archives the oldest inbox message through the app, as Done does. */
const archiveOldest = async (a: Booted): Promise<string> => {
  const target = a.mail.idsIn(INBOX)[0]!;
  const headerMessageId = `<msg-${target}@example.com>`;
  a.store().doneThread([a.mail.keyOf(target)]);
  a.store().dismissToast(a.store().toasts.at(-1)!.id);
  await settle();
  return headerMessageId;
};

const rowsWith = async (a: Booted, headerMessageId: string) =>
  a.db.messages.where("headerMessageId").equals(headerMessageId).toArray();

describe("after a Thunderbird restart", () => {
  it("keeps archived rows when their old ids go to new mail", async () => {
    app = await open();
    const archived = await archiveOldest(app);
    expect(await rowsWith(app, archived)).toMatchObject([{ origin: "done" }]);

    // Every id is handed out again from 1, then new mail arrives and a scan
    // caches it — under ids the archived row was cached with.
    app.mail.restartIds();
    await app.mail.deliver(INBOX, personalMail());
    await app.mail.deliver(INBOX, personalMail());
    await app.backfill.runBackfill();
    await settle();

    expect(await rowsWith(app, archived)).toMatchObject([{ origin: "done", folderId: ARCHIVE }]);
    const done = Object.values(app.store().messagesByKey).filter((m) => m.origin === "done");
    expect(done.map((m) => m.headerMessageId)).toEqual([archived]);
  });

  it("moves the right message back to the inbox when its cached id is stale", async () => {
    app = await open();
    const archived = await archiveOldest(app);
    app.mail.restartIds();
    const inboxBefore = app.mail.idsIn(INBOX).length;

    const [row] = await rowsWith(app, archived);
    app.store().moveToInboxThread([row!.key]);
    await settle();

    // The archived message came back, and nothing else left the inbox.
    expect(app.mail.idsIn(ARCHIVE)).toEqual([]);
    expect(app.mail.idsIn(INBOX)).toHaveLength(inboxBefore + 1);
    expect((await rowsWith(app, archived)).map((m) => m.origin)).toEqual(["inbox"]);
  });

  it("drops only the deleted message's row when a stale id collides", async () => {
    app = await open();
    const archived = await archiveOldest(app);
    app.mail.restartIds();

    // New mail takes the id the archived row was cached with; deleting it
    // must not take the archived row along.
    const [archivedRow] = await rowsWith(app, archived);
    const victim = await app.mail.deliver(INBOX, personalMail());
    await settle();
    expect(victim).toBe(archivedRow!.tbId);
    const victimKey = app.mail.keyOf(victim);
    await messenger.messages.delete([victim], true);
    await settle();

    expect(await app.db.messages.get(victimKey)).toBeUndefined();
    expect(await rowsWith(app, archived)).toHaveLength(1);
  });
});

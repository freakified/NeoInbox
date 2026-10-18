import { afterEach, describe, expect, it } from "vitest";
import { boot, type Booted } from "../test/boot";
import { many, personalMail, shapes } from "../test/fixtures";
import { settle } from "../test/fakeMessenger";

let app: Booted | undefined;
afterEach(async () => {
  await app?.db.delete();
  app = undefined;
});

const firstThreadSubject = (a: Booted): string | undefined => {
  const st = a.store();
  const item = a.deriveStream(st.messagesById, new Set()).sections[0]?.items[0];
  return item?.type === "thread" ? item.thread.subject : undefined;
};

describe("snooze wake", () => {
  it("keeps a woken thread at its wake time after Thunderbird renumbers it", async () => {
    app = await boot(shapes.standard(many(5, personalMail)));
    await app.store().init();
    await app.backfill.runBackfill();
    await settle();

    const oldest = Object.values(app.store().messagesById).sort((a, b) => a.date - b.date)[0]!;
    const wakeAt = Date.now() - 1_000;
    app.store().snoozeThread([oldest.id], wakeAt);
    await settle();

    const { wakeSnoozedMessage } = await import("./snooze");
    await wakeSnoozedMessage(oldest.id, "alarm");
    await settle();
    expect(firstThreadSubject(app)).toBe(oldest.subject);

    // An IMAP move back to the inbox settles on a new UID, and the next scan
    // sees a message it has never cached under that id.
    app.mail.remapIds();
    await app.backfill.runBackfill();
    await settle();

    const woken = Object.values(app.store().messagesById).find(
      (m) => m.headerMessageId === oldest.headerMessageId,
    )!;
    expect(woken.id).not.toBe(oldest.id);
    expect(woken.resurfacedAt).toBe(wakeAt);
    expect(woken.snoozeExpired).toBe(true);
    expect(firstThreadSubject(app)).toBe(oldest.subject);
  });

  it("forgets the wake position once the thread is snoozed again", async () => {
    app = await boot(shapes.standard(many(3, personalMail)));
    await app.store().init();
    await app.backfill.runBackfill();
    await settle();

    const oldest = Object.values(app.store().messagesById).sort((a, b) => a.date - b.date)[0]!;
    app.store().snoozeThread([oldest.id], Date.now() - 1_000);
    await settle();
    const { wakeSnoozedMessage } = await import("./snooze");
    await wakeSnoozedMessage(oldest.id, "alarm");
    await settle();
    expect(await app.db.resurfaced.count()).toBe(1);

    const woken = Object.values(app.store().messagesById).find(
      (m) => m.headerMessageId === oldest.headerMessageId,
    )!;
    app.store().snoozeThread([woken.id], Date.now() + 60_000);
    await settle();
    expect(await app.db.resurfaced.count()).toBe(0);
  });
});

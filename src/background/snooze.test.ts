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
  const item = a.deriveStream(st.messagesByKey, new Set()).sections[0]?.items[0];
  return item?.type === "thread" ? item.thread.subject : undefined;
};

describe("snooze wake", () => {
  it("keeps a woken thread at its wake time after Thunderbird renumbers it", async () => {
    app = await boot(shapes.standard(many(5, personalMail)));
    await app.store().init();
    await app.backfill.runBackfill();
    await settle();

    const oldest = Object.values(app.store().messagesByKey).sort((a, b) => a.date - b.date)[0]!;
    const wakeAt = Date.now() - 1_000;
    app.store().snoozeThread([oldest.key], wakeAt);
    await settle();

    const { wakeSnoozedMessage } = await import("./snooze");
    await wakeSnoozedMessage(oldest.key, "alarm");
    await settle();
    expect(firstThreadSubject(app)).toBe(oldest.subject);

    // An IMAP move back to the inbox settles on a new UID, and the next scan
    // sees a message it has never cached under that id.
    app.mail.remapIds();
    await app.backfill.runBackfill();
    await settle();

    const woken = Object.values(app.store().messagesByKey).find(
      (m) => m.headerMessageId === oldest.headerMessageId,
    )!;
    expect(woken.tbId).not.toBe(oldest.tbId);
    // Same message back in the same folder: same row, not a second one.
    expect(woken.key).toBe(oldest.key);
    expect(woken.resurfacedAt).toBe(wakeAt);
    expect(woken.snoozeExpired).toBe(true);
    expect(firstThreadSubject(app)).toBe(oldest.subject);
  });

  it("forgets the wake position once the thread is snoozed again", async () => {
    app = await boot(shapes.standard(many(3, personalMail)));
    await app.store().init();
    await app.backfill.runBackfill();
    await settle();

    const oldest = Object.values(app.store().messagesByKey).sort((a, b) => a.date - b.date)[0]!;
    app.store().snoozeThread([oldest.key], Date.now() - 1_000);
    await settle();
    const { wakeSnoozedMessage } = await import("./snooze");
    await wakeSnoozedMessage(oldest.key, "alarm");
    await settle();
    expect(await app.db.resurfaced.count()).toBe(1);

    const woken = Object.values(app.store().messagesByKey).find(
      (m) => m.headerMessageId === oldest.headerMessageId,
    )!;
    app.store().snoozeThread([woken.key], Date.now() + 60_000);
    await settle();
    expect(await app.db.resurfaced.count()).toBe(0);
  });

  it("puts a manually unsnoozed thread back at its own date", async () => {
    app = await boot(shapes.standard(many(3, personalMail)));
    await app.store().init();
    await app.backfill.runBackfill();
    await settle();

    const oldest = Object.values(app.store().messagesByKey).sort((a, b) => a.date - b.date)[0]!;
    app.store().snoozeThread([oldest.key], Date.now() + 60_000);
    await settle();
    app.store().unsnoozeThread([oldest.key]);
    // Not even briefly on top while the move back is in flight.
    expect(firstThreadSubject(app)).not.toBe(oldest.subject);
    await settle();

    const back = Object.values(app.store().messagesByKey).find(
      (m) => m.headerMessageId === oldest.headerMessageId,
    )!;
    expect(back.snoozed).toBe(false);
    expect(back.resurfacedAt).toBeUndefined();
    expect(await app.db.resurfaced.count()).toBe(0);
    expect(firstThreadSubject(app)).not.toBe(oldest.subject);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { boot, type Booted } from "../test/boot";
import { many, personalMail, shapes } from "../test/fixtures";
import { settle } from "../test/fakeMessenger";

let app: Booted | undefined;
afterEach(async () => {
  await app?.db.delete();
  app = undefined;
});

describe("mark read on open", () => {
  it("sets Thunderbird's read flag and keeps the row read", async () => {
    app = await boot(shapes.standard(many(3, personalMail)));
    await app.store().init();
    await app.backfill.runBackfill();
    await settle();

    const target = Object.values(app.store().messagesByKey)[0]!;
    expect(target.read).toBe(false);

    app.store().markThreadRead([target.key]);
    // Optimistic: the row turns read before the background answers.
    expect(app.store().messagesByKey[target.key]!.read).toBe(true);
    await settle();

    expect((await app.mail.messagesApi.get(target.tbId)).read).toBe(true);
    expect((await app.db.messages.get(target.key))!.read).toBe(true);
    expect(app.store().messagesByKey[target.key]!.read).toBe(true);
  });

  it("resolves a renumbered message by Message-ID before flagging it", async () => {
    app = await boot(shapes.standard(many(3, personalMail)));
    await app.store().init();
    await app.backfill.runBackfill();
    await settle();

    const target = Object.values(app.store().messagesByKey)[0]!;
    app.mail.remapIds();

    app.store().markThreadRead([target.key]);
    await settle();

    const row = (await app.db.messages.get(target.key))!;
    expect(row.tbId).not.toBe(target.tbId);
    expect((await app.mail.messagesApi.get(row.tbId)).read).toBe(true);
    // Only the one message: the stale id must not have flagged another.
    const others = Object.values(app.store().messagesByKey).filter((m) => m.key !== target.key);
    expect(others.every((m) => !m.read)).toBe(true);
  });

  it("sends nothing for a conversation that is already read", async () => {
    app = await boot(shapes.standard(many(2, personalMail)));
    await app.store().init();
    await app.backfill.runBackfill();
    await settle();

    const keys = Object.keys(app.store().messagesByKey);
    app.store().markThreadRead(keys);
    await settle();
    const before = app.store().messagesByKey;
    app.store().markThreadRead(keys);
    // No optimistic write either, so the map is untouched.
    expect(app.store().messagesByKey).toBe(before);
  });
});

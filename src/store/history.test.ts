/**
 * The SPA loads Sent and Done a page at a time instead of the whole table.
 * These check what is in memory after startup, after paging, and when a delta
 * names a row outside the loaded window.
 */
import { describe, expect, it } from "vitest";
import { boot, type Booted } from "../test/boot";
import { shapes } from "../test/fixtures";
import { HISTORY_PAGE } from "./history";
import type { MessageOrigin, RawMessage } from "../shared/types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

const row = (id: number, origin: MessageOrigin, date: number): RawMessage => ({
  key: `k${id}`,
  tbId: id,
  headerMessageId: `<m${id}@x>`,
  subject: `m${id}`,
  author: "a@x.com",
  recipients: [],
  ccList: [],
  bccList: [],
  date,
  size: 1,
  read: true,
  folderId: origin,
  accountId: "a",
  tags: [],
  category: null,
  pinned: false,
  snoozed: false,
  origin,
});

/** `count` Done rows, one a day going back from today, ids from 1000. */
const doneRows = (count: number): RawMessage[] =>
  Array.from({ length: count }, (_, i) => row(1000 + i, "done", NOW - i * DAY));

const open = async (rows: RawMessage[], seed?: (app: Booted) => Promise<void>): Promise<Booted> => {
  const app = await boot(shapes.standard(), { wireBackground: false });
  await app.db.messages.bulkPut(rows);
  await seed?.(app);
  await app.store().init();
  return app;
};

const loadedKeys = (app: Booted): Set<string> =>
  new Set(Object.keys(app.store().messagesByKey));

describe("history paging", () => {
  it("loads everything when Sent and Done fit in one page", async () => {
    const app = await open([row(1, "inbox", NOW - 900 * DAY), ...doneRows(10)]);
    expect(loadedKeys(app).size).toBe(11);
    expect(app.store().historyFrom).toBe(0);
  });

  it("loads the newest page of Done but every inbox row however old", async () => {
    const extra = 20;
    const app = await open([row(1, "inbox", NOW - 9000 * DAY), ...doneRows(HISTORY_PAGE + extra)]);
    const ids = loadedKeys(app);
    expect(ids.has(`k${1}`)).toBe(true);
    expect(ids.has(`k${1000}`)).toBe(true);
    expect(ids.has(`k${1000 + HISTORY_PAGE + extra - 1}`)).toBe(false);
    expect(app.store().historyFrom).toBe(NOW - (HISTORY_PAGE - 1) * DAY);
  });

  it("loads old Done mail a trip still shows", async () => {
    const all = doneRows(HISTORY_PAGE + 20);
    const oldest = all.at(-1)!;
    const app = await open(all, async (a) => {
      await a.db.trips.put({ id: "t", name: "Lisbon", nameIsCustom: true, createdAt: 0 });
      await a.db.tripMemberships.put({
        key: oldest.headerMessageId,
        tripId: "t",
        source: "auto",
        addedAt: 0,
      });
    });
    expect(loadedKeys(app).has(oldest.key)).toBe(true);
  });

  it("pages in older mail until none is left", async () => {
    const total = HISTORY_PAGE + 20;
    const app = await open(doneRows(total));
    await app.store().loadOlderHistory();
    expect(loadedKeys(app).size).toBe(total);
    expect(app.store().historyFrom).toBe(0);
  });

  it("ignores a delta for an old row that was never paged in", async () => {
    const all = doneRows(HISTORY_PAGE + 20);
    const app = await open(all);
    const old = all.at(-1)!;
    const fresh = row(1, "inbox", NOW);
    // Drive the delta path the background would.
    const { applyServerMsg } = await import("./serverMsg");
    applyServerMsg(app.useMailStore.setState, app.useMailStore.getState, {
      type: "delta",
      updated: [{ ...old, read: false }],
      added: [fresh],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadedKeys(app).has(old.key)).toBe(false);
    expect(loadedKeys(app).has(fresh.key)).toBe(true);
  });
});

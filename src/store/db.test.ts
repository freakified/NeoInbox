/**
 * Schema upgrades run once, against whatever years-old rows a real profile
 * holds, so each one gets checked against a database written by the version
 * before it.
 */
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { db } from "./db";

describe("version 19", () => {
  it("gives rows cached before Cc/Bcc existed empty lists", async () => {
    const old = new Dexie("neoinbox");
    old.version(18).stores({
      messages:
        "id, date, accountId, folderId, detailsVersion, headerMessageId, [origin+date], [origin+classifierVersion]",
    });
    await old.table("messages").bulkPut([
      { id: 1, origin: "done", date: 1, detailsVersion: 3, headerMessageId: "<a@x>" },
      {
        id: 2,
        origin: "done",
        date: 2,
        detailsVersion: 3,
        headerMessageId: "<b@x>",
        recipients: ["to@x.com"],
        ccList: ["cc@x.com"],
        bccList: [],
      },
    ]);
    old.close();

    const [legacy, current] = await db.messages.bulkGet([1, 2]);
    expect(legacy).toMatchObject({ recipients: [], ccList: [], bccList: [] });
    expect(current).toMatchObject({ recipients: ["to@x.com"], ccList: ["cc@x.com"], bccList: [] });
  });
});

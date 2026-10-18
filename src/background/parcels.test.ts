/**
 * Parcel tracking rides on the details fetch: the same getFull that gives an
 * inbox row its snippet finds its tracking numbers, and rows cached before
 * parcels existed get them from the details sweep.
 */
import { describe, expect, it } from "vitest";
import { boot } from "../test/boot";
import { INBOX, personalMail, shapes } from "../test/fixtures";
import { settle } from "../test/fakeMessenger";

const shippedMail = () => ({
  author: "Field Supply <orders@fieldsupply.example>",
  subject: "Your order has shipped",
  html: "<p>Carrier: UPS<br>Tracking number: 1Z999AA10123456784</p>",
});

describe("parcels on inbox rows", () => {
  it("stores the tracking numbers a scanned message carries, and nothing on other mail", async () => {
    const app = await boot(shapes.standard([shippedMail(), personalMail()]));

    await app.backfill.runBackfill();
    await settle();

    const rows = await app.db.messages.toArray();
    const shipped = rows.find((r) => r.subject === "Your order has shipped");
    expect(shipped?.parcels).toEqual([
      { carrier: "ups", number: "1Z999AA10123456784", url: "https://www.ups.com/track?tracknum=1Z999AA10123456784" },
    ]);
    expect(rows.filter((r) => r.parcels)).toHaveLength(1);
  });

  it("fills in parcels for rows cached under the previous details version", async () => {
    const app = await boot(shapes.standard([shippedMail()]));
    await app.backfill.runBackfill();
    await settle();
    await app.db.messages.toCollection().modify((m) => {
      delete m.parcels;
      m.detailsVersion = 1;
    });

    await app.backfill.fillMissingDetails();

    const [row] = await app.db.messages.where("folderId").equals(INBOX).toArray();
    expect(row?.parcels?.map((p) => p.number)).toEqual(["1Z999AA10123456784"]);
  });
});

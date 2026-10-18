/**
 * Shapes findParcels must read, as minimal synthetic mail (the real-mail
 * suite in src/eval/packages.eval.ts is local-only). Numbers are made up but
 * carry valid check digits; comments name the sender each shape came from.
 */
import { describe, expect, it } from "vitest";
import { buildExtractorInput } from "../samples";
import { findParcels } from "./tracking";

const parcels = (author: string, subject: string, body: { html?: string; text?: string }): string[] =>
  findParcels(
    buildExtractorInput({
      author,
      subject,
      date: Date.UTC(2026, 9, 1),
      textParts: body.text ? [body.text] : [],
      htmlParts: body.html ? [body.html] : [],
    }),
  ).map((p) => `${p.carrier}:${p.number ?? "link"}`);

describe("findParcels", () => {
  it("reads a labelled Yamato slip number written with dashes", () => {
    expect(parcels("ヤマト運輸 <mail@kuronekoyamato.co.jp>", "お荷物お届けのお知らせ", {
      text: "■送り状番号：1234-5678-9013\nヤマト運輸株式会社",
    })).toEqual(["yamato:123456789013"]);
  });

  it("takes the carrier labelled before the number over a footer naming every carrier", () => {
    // Furusato-nozei shipping notices link all three carriers in the footer.
    expect(parcels("shop <shop@shop.rakuten.co.jp>", "お礼の品の出荷のお知らせ", {
      text:
        "[配送会社] 佐川急便 [伝票番号] 490000000011\n" +
        "ヤマト運輸 https://toi.kuronekoyamato.co.jp/ 日本郵便 https://trackings.post.japanpost.jp/",
    })).toEqual(["sagawa:490000000011"]);
  });

  it("reads a comma-separated list and the carrier link holding both numbers", () => {
    // Yodobashi: 配達受付番号（伝票番号）：A,B with a Japan Post link listing both.
    expect(parcels("ヨドバシ <thanks_gift@yodobashi.com>", "ご注文商品出荷のお知らせ", {
      text:
        "配達受付番号（伝票番号）：152000000014,152000000025\n" +
        "http://tracking.post.japanpost.jp/service/singleSearch.do?reqCodeNo1=152000000014&reqCodeNo2=152000000025",
    })).toEqual(["japanpost:152000000014", "japanpost:152000000025"]);
  });

  it("finds unlabelled UPS numbers only when the check digit agrees", () => {
    expect(parcels("Shop <orders@shop.example>", "Your order has shipped", {
      text: "Your package 1Z999AA10123456784 is on its way. Ref 1Z999AA10123456785.",
    })).toEqual(["ups:1Z999AA10123456784"]);
  });

  it("unwraps a USPS 420+ZIP+4 barcode string to the tracking number", () => {
    expect(parcels("USPS <auto-reply@usps.com>", "USPS® Expected Delivery", {
      html: '<a href="https://tools.usps.com/go/TrackConfirmAction?tLabels=4209410940029400100000000000000006">Track</a>',
    })).toEqual(["usps:9400100000000000000006"]);
  });

  it("counts Amazon's per-package links when no number is printed, one per shipment", () => {
    const track = (id: string) =>
      `https://www.amazon.com/gp/r.html?C=X&U=${encodeURIComponent(
        `https://www.amazon.com/progress-tracker/package?orderId=111-1&packageIndex=0&shipmentId=${id}`,
      )}`;
    expect(parcels("Amazon.com <shipment-tracking@amazon.com>", "Your Amazon.com order has shipped", {
      html: `<a href="${track("AAA")}">Track</a><a href="${track("AAA")}">Track</a><a href="${track("BBB")}">Track</a>`,
    })).toEqual(["amazon:link", "amazon:link"]);
  });

  it("prefers a printed Amazon tracking number over the package link", () => {
    expect(parcels("Amazon.co.jp <shipment-tracking@amazon.co.jp>", "Arriving today", {
      text:
        "Shipping company: Amazon Tracking number: DA0000000001 Track your package: " +
        "https://www.amazon.co.jp/progress-tracker/package?orderId=1&shipmentId=AAA",
    })).toEqual(["amazon:DA0000000001"]);
  });

  it("ignores order and phone numbers, and a bare 配送番号 that is no carrier's", () => {
    expect(parcels("ヨドバシ <thanks_gift@yodobashi.com>", "ご注文ありがとうございます", {
      text: "【ご注文番号】 7009876543\nお問い合わせ窓口 電話: 0120-202-422\n配送番号：1600012345",
    })).toEqual([]);
  });

  it("does not glue a following year onto the number", () => {
    expect(parcels("佐川急便 <info@ds.sagawa-exp.co.jp>", "お荷物お届け予定日", {
      text: "お問い合せ送り状No. 490000000011 2026年10月2日",
    })).toEqual(["sagawa:490000000011"]);
  });

  it("takes the number from a carrier's subject line", () => {
    expect(parcels("FedEx <TrackingUpdates@fedex.com>", "FedEx Shipment 123456789012: delivered", {
      text: "Your package has been delivered.",
    })).toEqual(["fedex:123456789012"]);
  });

  it("infers FedEx for a bare 12-digit number by its check digit", () => {
    // PetSmart prints the number under "Track your order:" and names no carrier.
    expect(parcels("PetSmart <orders@mail.petsmart.com>", "Your order is on its way!", {
      text: "Track your order: https://click.example.com/?qs=abc\n123456789012",
    })).toEqual(["fedex:123456789012"]);
  });
});

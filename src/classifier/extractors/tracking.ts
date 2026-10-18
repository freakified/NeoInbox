/**
 * Parcel tracking: the numbers a shipping email lets you track, and which
 * carrier they belong to. Deliberately stateless — the card links to the
 * carrier's own page instead of following the parcel through its emails.
 *
 * Evidence, strongest first: a carrier link that carries the number, a
 * labelled number ("送り状番号", "Tracking #"), a number whose format and
 * check digit identify it anywhere in the text (UPS 1Z…, EN…JP), and a
 * number in the subject of mail from a carrier. Amazon never prints its
 * numbers, so its per-package progress-tracker links count on their own.
 */
import type { Carrier, Parcel } from "../../shared/types";
import { decodeEntities } from "./text";
import type { ExtractorInput } from "./types";

// ─── check digits ───────────────────────────────────────────────────────────

const digitsOf = (n: string): number[] => [...n].map(Number);

/** Weighted sum of a number's body, weights applied from its rightmost digit. */
const weighted = (body: string, weights: readonly number[]): number =>
  digitsOf(body)
    .reverse()
    .reduce((sum, d, i) => sum + d * weights[i % weights.length]!, 0);

const checkDigit = (n: string): number => Number(n.slice(-1));

/** Yamato, Sagawa and Japan Post: the first eleven digits mod 7. */
const jpOk = (n: string): boolean =>
  /^\d{12}$/.test(n) && Number(n.slice(0, 11)) % 7 === checkDigit(n);

/** FedEx Express 12-digit: weights 1,3,7 from the right, mod 11. */
const fedexOk = (n: string): boolean =>
  /^\d{12}$/.test(n) && (weighted(n.slice(0, 11), [1, 3, 7]) % 11) % 10 === checkDigit(n);

/** USPS IMpb: weights 3,1 from the right, mod 10. */
const uspsOk = (n: string): boolean =>
  /^\d{20,26}$/.test(n) && (10 - (weighted(n.slice(0, -1), [3, 1]) % 10)) % 10 === checkDigit(n);

/** UPU S10 (EMS, registered mail): "EN157980325JP". */
const s10Ok = (n: string): boolean => {
  const m = /^[A-Z]{2}(\d{8})(\d)[A-Z]{2}$/.exec(n);
  if (!m) return false;
  const check = 11 - (weighted(m[1]!, [7, 9, 5, 3, 2, 4, 6, 8]) % 11);
  return (check === 10 ? 0 : check === 11 ? 5 : check) === Number(m[2]);
};

/** UPS 1Z: letters fold to digits, every second one doubled, mod 10. */
const upsOk = (n: string): boolean => {
  if (!/^1Z[0-9A-Z]{16}$/.test(n)) return false;
  const body = [...n.slice(2, 17)].map((c) => (/\d/.test(c) ? c : String((c.charCodeAt(0) - 63) % 10))).join("");
  // 15 digits: from the right, the first is undoubled, the second doubled…
  return (10 - (weighted(body, [1, 2]) % 10)) % 10 === checkDigit(n);
};

// ─── carriers ───────────────────────────────────────────────────────────────

const TRACK_URL: Partial<Record<Carrier, (n: string) => string>> = {
  ups: (n) => `https://www.ups.com/track?tracknum=${n}`,
  usps: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`,
  fedex: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
  dhl: (n) => `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${n}&submit=1`,
  ontrac: (n) => `https://www.ontrac.com/tracking/?number=${n}`,
  yamato: (n) => `https://toi.kuronekoyamato.co.jp/cgi-bin/tneko?number00=1&number01=${n}`,
  sagawa: (n) => `https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=${n}`,
  japanpost: (n) => `https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo1=${n}&locale=ja`,
};

/**
 * Carrier tracking links: the host, then the query parameters holding
 * numbers (global — one Yamato or Japan Post link can list several parcels).
 */
const LINK_RULES: [RegExp, RegExp, Carrier][] = [
  [/https?:\/\/[\w.-]*ups\.com\//i, /[?&](?:tracknum|InquiryNumber\d|trackNums?)=([0-9A-Z]{10,})/gi, "ups"],
  [/https?:\/\/[\w.-]*usps\.com\//i, /[?&](?:tLabels|qtc_tLabels\d|tracknumbers?)=([0-9A-Z]{10,})/gi, "usps"],
  [/https?:\/\/[\w.-]*fedex\.com\//i, /[?&](?:trknbr|tracknumbers?|trackingnumber)=(\d{10,})/gi, "fedex"],
  [/https?:\/\/[\w.-]*dhl\.[a-z.]+\//i, /[?&](?:AWB|tracking-id|trackingNumber|piececode)=([0-9A-Z]{8,})/gi, "dhl"],
  [/https?:\/\/[\w.-]*ontrac\.com\//i, /[?&](?:number|tracking)\w*=([0-9A-Z]{10,})/gi, "ontrac"],
  [/https?:\/\/[\w.-]*kuronekoyamato\.co\.jp\//i, /[?&](?:pno|number0[1-9]|no0[1-9]|slipNo|id(?==\d{12}(?!\w)))=(\d{10,14})(?!\w)/gi, "yamato"],
  [/https?:\/\/[\w.-]*sagawa-exp\.co\.jp\//i, /[?&]okurijoNo=(\d{10,14})/gi, "sagawa"],
  [/https?:\/\/[\w.-]*japanpost\.jp\//i, /[?&]reqCodeNo\d=([0-9A-Z]{10,14})/gi, "japanpost"],
  [/https?:\/\/[\w.-]*swiship\.com\/track/i, /[?&]id=(TBA\d{9,15})/gi, "amazon"],
];

const CARRIER_NAMES: [RegExp, Carrier][] = [
  [/ヤマト|クロネコ|宅急便|ネコポス|\byamato\b/i, "yamato"],
  [/佐川|\bsagawa\b/i, "sagawa"],
  [/日本郵便|ゆうパック|ゆうパケット|ゆうメール|クリックポスト|レターパック|\bjapan\s*post\b/i, "japanpost"],
  [/ヨドバシエクストリーム/, "yodobashi"],
  [/\bups\b|united parcel service/i, "ups"],
  [/\busps\b|postal service/i, "usps"],
  [/\bfedex\b/i, "fedex"],
  [/\bdhl\b|dhlglobalmail/i, "dhl"],
  [/\bontrac\b/i, "ontrac"],
  [/^amazon$/i, "amazon"],
  // "◆配送業者：https://toi.kuronekoyamato.co.jp/…" names it by its site.
  [/kuronekoyamato\.co\.jp/i, "yamato"],
  [/sagawa-exp\.co\.jp/i, "sagawa"],
  [/japanpost\.jp/i, "japanpost"],
];

/** Mail sent by a carrier is about that carrier's parcels. */
const SENDER_CARRIERS: [RegExp, Carrier][] = [
  [/(^|\.)kuronekoyamato\.co\.jp$/, "yamato"],
  [/(^|\.)sagawa-exp\.co\.jp$/, "sagawa"],
  [/(^|\.)japanpost\.jp$/, "japanpost"],
  [/(^|\.)ups\.com$/, "ups"],
  [/(^|\.)usps\.(com|gov)$/, "usps"],
  [/(^|\.)fedex\.com$/, "fedex"],
  [/(^|\.)dhl\.com$/, "dhl"],
];

/** A label naming the carrier right before a number: "[配送会社] 佐川急便". */
const CARRIER_LABEL_RE =
  /(?:配送会社|配送方法|配送業者|運送会社|配達会社|配達担当|今回の配達|carrier|shipping\s+company|shipped\s+(?:via|with|by)|sent\s+by|delivered\s+by|shipping\s+method)\s*[\]】)|:：]?\s*◆?\s*(.{0,40})/gi;

// ─── numbers ────────────────────────────────────────────────────────────────

/**
 * The words a tracking number follows. "お問い合わせ番号" alone is any
 * inquiry number, so the Japanese labels name the slip (伝票/送り状) or the
 * parcel; bare 配送番号 also needs a carrier-valid number (see below).
 */
const LABEL_RE = new RegExp(
  "(?:tracking\\s*(?:number|#|no\\.?|id)s?|track(?:ing)?\\s*#|track\\s+your\\s+(?:order|package|shipment)\\s*:|waybill\\s*(?:number|no\\.?)|\\bAWB\\s*no\\.?|追跡番号|" +
    "お?問い?合わ?せ(?:送り状|伝票)?\\s*(?:No\\.?|番号)|(?:お荷物|お届け|配送|配達|登録)?伝票番号|送り状番号|荷物番号|配達受付番号|(配送番号))" +
    "\\s*(?:\\([^)]{0,12}\\)|（[^）]{0,12}）)?[\\]】)）:：#|\\s]*(?:is\\s*)?[:：]?\\s*(?:https?:\\/\\/\\S+\\s*)?",
  "gi",
);

/**
 * The number right after a label. Spaces only join four-digit groups (USPS
 * prints "9400 1092 0556 …"), so "491844631725 2026年" stops at the number.
 */
const NUMBER_AT_RE = /^(?:[A-Z]{1,3})?\d+(?:-\d+)*(?:(?<=(?:^|\s)\d{4}) \d+)*(?:[A-Z]{2}(?![A-Za-z]))?/;

/** Formats safe to take without a label, once their check digit agrees. */
const FREE_FORMATS: [RegExp, (n: string) => Carrier | null][] = [
  [/\b1Z[0-9A-Z]{16}\b/g, (n) => (upsOk(n) ? "ups" : null)],
  [/\b[A-Z]{2}\d{9}(?:JP|US)\b/g, (n) => (!s10Ok(n) ? null : n.endsWith("JP") ? "japanpost" : "usps")],
  [/\b9[1-5]\d{18,24}\b/g, (n) => (uspsOk(n) ? "usps" : null)],
  [/\bTBA\d{12}\b/g, () => "amazon"],
];

const normalize = (raw: string): string => raw.replace(/[\s-]/g, "").toUpperCase();

/** The 22-digit number inside a USPS "420 + ZIP+4" barcode string. */
const unwrapUsps = (n: string): string => /^420\d{9}(9\d{21})$/.exec(n)?.[1] ?? n;

/** Carrier implied by the number itself. */
const carrierOfFormat = (n: string): Carrier | null => {
  for (const [re, carrierOf] of FREE_FORMATS) {
    re.lastIndex = 0;
    const m = re.exec(n);
    if (m && m[0] === n) return carrierOf(n);
  }
  if (/^C\d{14}$/.test(n)) return "ontrac";
  if (/^DA\d{10}$/.test(n)) return "amazon";
  return null;
};

const namedCarrier = (text: string): Carrier | null => {
  const found = new Set<Carrier>();
  for (const [re, carrier] of CARRIER_NAMES) if (re.test(text)) found.add(carrier);
  return found.size === 1 ? [...found][0]! : null;
};

// ─── links ──────────────────────────────────────────────────────────────────

const linksOf = (input: ExtractorInput): string[] => {
  const raw = `${input.html}\n${input.text}`;
  const out: string[] = [];
  for (const m of raw.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
    let url = decodeEntities(m[0]);
    try {
      // Redirect wrappers carry the real link percent-encoded.
      url = decodeURIComponent(url);
    } catch {
      // A stray % — keep the link as it was.
    }
    out.push(url);
  }
  return out;
};

const AMAZON_TRACK_RE =
  /https:\/\/(?:www|smile)\.amazon\.(?:com|co\.jp|co\.uk|ca|de)\/(?:progress-tracker\/package|gp\/your-account\/ship-track|gp\/css\/shiptrack\/view\.html)[^?\s"'<>]*\?[^\s"'<>]*?(?:ordering)?[sS]hipmentId=([\w-]+)[^\s"'<>&]*(?:&[^\s"'<>&]*)*/;

// ─── extraction ─────────────────────────────────────────────────────────────

export const findParcels = (input: ExtractorInput): Parcel[] => {
  const text = `${input.subject}\n${input.text}`.replace(/\s+/g, " ");
  const links = linksOf(input);
  const sender = SENDER_CARRIERS.find(([re]) => re.test(input.senderDomain))?.[1] ?? null;

  const linked = new Map<string, Set<Carrier>>();
  for (const url of links) {
    for (const [host, params, carrier] of LINK_RULES) {
      // Searched anywhere: redirect wrappers carry the carrier link inside.
      const at = url.search(host);
      if (at < 0) continue;
      for (const m of url.slice(at).matchAll(params)) {
        const n = unwrapUsps(normalize(m[1]!));
        linked.set(n, (linked.get(n) ?? new Set()).add(carrier));
      }
    }
  }

  const wholeMessage = namedCarrier(text);
  const carrierAt = (n: string, start: number, end: number): Carrier => {
    const before = text.slice(Math.max(0, start - 200), start);
    const labelled = [...before.matchAll(CARRIER_LABEL_RE)].reverse();
    for (const m of labelled) {
      const c = namedCarrier(m[1] ?? "");
      if (c) return c;
    }
    const viaLink = linked.get(n);
    if (viaLink?.size === 1) return [...viaLink][0]!;
    if (sender) return sender;
    const byFormat = carrierOfFormat(n);
    if (byFormat) return byFormat;
    const after = /^.{0,40}?(?:配送業者|配送会社|carrier)\s*[:：|]?\s*(.{0,60})/i.exec(text.slice(end, end + 120));
    const named = (after && namedCarrier(after[1]!)) ?? namedCarrier(text.slice(Math.max(0, start - 120), end + 60));
    if (named) return named;
    // Yodobashi's own fleet is only named in the subject.
    if (wholeMessage) return wholeMessage;
    if (fedexOk(n) && !jpOk(n)) return "fedex";
    return "unknown";
  };

  const found = new Map<string, Carrier>();
  const add = (n: string, carrier: Carrier): void => {
    const prev = found.get(n);
    if (!prev || prev === "unknown") found.set(n, carrier);
  };

  for (const m of text.matchAll(LABEL_RE)) {
    let start = m.index + m[0].length;
    // "配達受付番号（伝票番号）：335072700966,335072700970" lists several.
    for (;;) {
      const raw = NUMBER_AT_RE.exec(text.slice(start, start + 48))?.[0];
      if (!raw) break;
      const n = unwrapUsps(normalize(raw));
      const end = start + raw.length;
      // A bare 配送番号 is often the shop's own delivery id.
      const plausible = n.replace(/\D/g, "").length >= 8 && n.length <= 34 && (!m[1] || jpOk(n) || linked.has(n));
      if (plausible) add(n, carrierAt(n, m.index, end));
      const more = /^\s*[,、]\s*/.exec(text.slice(end, end + 4));
      if (!plausible || !more) break;
      start = end + more[0].length;
    }
  }

  for (const [n, carriers] of linked) {
    if (found.has(n)) continue;
    add(n, carriers.size === 1 ? [...carriers][0]! : "unknown");
  }

  for (const [re, carrierOf] of FREE_FORMATS) {
    for (const m of text.matchAll(re)) {
      const n = m[0];
      if (found.has(n)) continue;
      const c = carrierOf(n);
      if (c) add(n, sender ?? c);
    }
  }

  // Carriers put the number in the subject: "FedEx Shipment 275197342130".
  if (sender) {
    for (const m of input.subject.matchAll(/(?<![\d-])(\d{10,26})(?![\d-])/g)) add(m[1]!, sender);
  }

  const parcels: Parcel[] = [...found].map(([number, carrier]) => {
    const url = TRACK_URL[carrier]?.(number) ?? (carrier === "amazon" && number.startsWith("TBA")
      ? `https://www.swiship.com/track?id=${number}`
      : undefined);
    return { carrier, number, ...(url ? { url } : {}) };
  });
  if (parcels.length) return parcels;

  // No number anywhere: the shop's own per-package pages.
  const shipments = new Map<string, string>();
  for (const url of links) {
    const m = AMAZON_TRACK_RE.exec(url);
    if (m && !shipments.has(m[1]!)) shipments.set(m[1]!, m[0]);
  }
  if (shipments.size) return [...shipments.values()].map((url) => ({ carrier: "amazon", url }));

  if (/配達担当\s*[:：]\s*ヨドバシエクストリーム/.test(text)) {
    const url = links.find((u) => /order\.yodobashi\.com\/.*order_history/.test(u));
    return [{ carrier: "yodobashi", ...(url ? { url } : {}) }];
  }
  return [];
};

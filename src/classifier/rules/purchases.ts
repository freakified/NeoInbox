/**
 * Things you bought and things being delivered to you.
 *
 * Three ways in: a shipping carrier (whatever it says), a known retailer with
 * a purchase-shaped subject, or — the branch that covers the long tail of
 * shops no list will ever hold — an organisational sender with an
 * unambiguous purchase noun in the subject.
 */
import type { Features } from "../features";
import { domainMatches } from "../features";
import { isBulk, isOrganizationalSender, PROMO_SUBJECT_RE } from "../signals";
import { isFinanceDomain } from "./finance";
import { isServiceDomain } from "./updates";

const RETAIL_DOMAINS = [
  // Marketplaces and general merchandise.
  "amazon.com", "amazon.co.uk", "amazon.ca", "amazon.de", "amazon.fr",
  "amazon.co.jp", "amazon.it", "amazon.es", "amazon.com.au", "amazon.in",
  "amazon.com.br", "amazon.nl", "amazon.se", "amazon.pl", "amazon.com.mx",
  "ebay.com", "ebay.co.uk", "ebay.de", "etsy.com", "aliexpress.com",
  "alibaba.com", "temu.com", "shein.com", "wish.com", "mercari.com",
  "poshmark.com", "depop.com", "vinted.com", "stockx.com", "goat.com",
  "grailed.com", "reverb.com", "discogs.com", "abebooks.com",
  "target.com", "walmart.com", "costco.com", "samsclub.com", "bjs.com",
  "bestbuy.com", "newegg.com", "bhphotovideo.com", "adorama.com",
  "microcenter.com", "gamestop.com", "overstock.com", "wayfair.com",
  "homedepot.com", "lowes.com", "menards.com", "acehardware.com",
  "harborfreight.com", "ikea.com", "containerstore.com", "crateandbarrel.com",
  "westelm.com", "potterybarn.com", "article.com", "casper.com",
  "officedepot.com", "staples.com", "michaels.com", "1800flowers.com",
  "dell.com", "samsung.com", "lego.com", "backmarket.com", "iherb.com",
  "barnesandnoble.com", "bookshop.org", "thriftbooks.com",
  "peloton.com", "garmin.com",
  // UK, Europe and elsewhere.
  "argos.co.uk", "johnlewis.co.uk", "currys.co.uk", "tesco.com",
  "sainsburys.co.uk", "ocado.com", "marksandspencer.com", "boots.com",
  "zalando.com", "zalando.de", "zalando.co.uk", "otto.de", "bol.com",
  "mediamarkt.de", "mercadolibre.com", "flipkart.com", "coupang.com",
  // Japan.
  "rakuten.co.jp", "yodobashi.com", "biccamera.com", "mercari.jp", "zozo.jp",
  "monotaro.com", "askul.co.jp", "muji.net",
  // Apparel, beauty and sport.
  "nike.com", "adidas.com", "underarmour.com", "lululemon.com", "zappos.com",
  "nordstrom.com", "macys.com", "kohls.com", "jcpenney.com", "dillards.com",
  "gap.com", "oldnavy.com", "bananarepublic.com", "uniqlo.com", "hm.com",
  "zara.com", "asos.com", "boohoo.com", "revolve.com", "everlane.com",
  "madewell.com", "jcrew.com", "landsend.com", "llbean.com", "patagonia.com",
  "rei.com", "backcountry.com", "moosejaw.com", "dickssportinggoods.com",
  "footlocker.com", "finishline.com", "dsw.com", "sephora.com", "ulta.com",
  "glossier.com", "warbyparker.com", "zenni.com", "1800contacts.com",
  "urbanoutfitters.com", "anthropologie.com", "freepeople.com",
  "abercrombie.com", "ae.com", "allbirds.com", "ssense.com", "farfetch.com",
  "thredup.com", "therealreal.com",
  // Software, media and games.
  "apple.com", "itunes.com", "steampowered.com", "valvesoftware.com",
  "epicgames.com", "playstation.com", "sonyentertainmentnetwork.com",
  "xbox.com", "nintendo.com", "humblebundle.com", "gog.com", "itch.io",
  "audible.com", "kobo.com", "bandcamp.com",
  // Payments, storefront platforms and invoicing.
  "stripe.com", "squareup.com", "square.com", "shopify.com", "shopifyemail.com",
  "bigcommerce.com", "woocommerce.com", "gumroad.com", "lemonsqueezy.com",
  "paddle.com", "fastspring.com", "sendowl.com", "ticketmaster.com",
  "livenation.com", "stubhub.com", "seatgeek.com", "eventbrite.com",
  "eventbrite-mail.com",
  "axs.com", "vividseats.com", "fandango.com", "atomtickets.com",
  // Food, grocery and delivery.
  "doordash.com", "ubereats.com", "grubhub.com", "seamless.com",
  "instacart.com", "postmates.com", "caviar.com", "gopuff.com", "shipt.com",
  "drizly.com", "hellofresh.com", "blueapron.com", "homechef.com",
  "factor75.com", "thrivemarket.com", "misfitsmarket.com", "imperfectfoods.com",
  "freshdirect.com", "kroger.com", "safeway.com", "albertsons.com",
  "publix.com", "wholefoodsmarket.com", "traderjoes.com", "sprouts.com",
  "wegmans.com", "heb.com", "meijer.com", "aldi.us",
  "deliveroo.com", "deliveroo.co.uk", "just-eat.co.uk", "wolt.com",
  "toasttab.com", "starbucks.com", "chipotle.com", "dominos.com", "papajohns.com",
  "pizzahut.com", "mcdonalds.com", "panerabread.com", "dunkindonuts.com",
  // Pharmacy, pets and household.
  "walgreens.com", "cvs.com", "riteaid.com", "goodrx.com",
  "chewy.com", "petco.com", "petsmart.com", "bark.co", "farmersdog.com",
  "grove.co", "brandless.com",
];

const CARRIER_DOMAINS = [
  "usps.com", "usps.gov", "ups.com", "fedex.com", "dhl.com", "dhl.de",
  "ontrac.com", "lasership.com", "shipwithveho.com", "gso.com",
  "aramex.com", "tnt.com", "gls-group.com", "dpd.com", "dpd.co.uk",
  "hermesworld.com", "evri.com", "yodel.co.uk", "royalmail.com",
  "parcelforce.com", "canadapost.ca", "canadapost-postescanada.ca",
  "purolator.com", "auspost.com.au", "nzpost.co.nz", "postnord.com",
  "posti.fi", "bring.com", "correos.es", "poste.it", "laposte.fr",
  "chronopost.fr", "colissimo.fr", "deutschepost.de", "swisspost.ch",
  "sf-express.com", "japanpost.jp", "kuronekoyamato.co.jp", "sagawa-exp.co.jp",
  "cainiao.com", "4px.com",
  // Tracking aggregators and post-purchase platforms — always about a parcel.
  "aftership.com", "narvar.com", "route.com", "shippo.com", "shipstation.com",
  "parcelsapp.com", "17track.net", "packagetrackr.com", "shoprunner.com",
];

/**
 * Purchase wording that survives without a known sender domain. Every term
 * here names the transaction or the parcel; nothing here is a word a service
 * would use about your account. Parcel words need a qualifier ("your
 * package", "tracking number") because on their own they are also software
 * packages, time tracking and mail delivery.
 *
 * Japanese terms sit outside the \b group: \b only knows ASCII word
 * characters, so it never matches next to kana or kanji. お届け alone is left
 * out — 「最新情報をお届けします」 is how every Japanese newsletter opens.
 */
const PURCHASE_STRONG_RE =
  /\b(receipt|e[- ]?receipt|order(?:ed|s)?|invoice|purchase[ds]?|shipped|shipment|shipping\s+(?:confirmation|update|notice|label)|dispatched|delivered|out\s+for\s+delivery|on\s+its\s+way|in\s+transit|tracking\s+(?:number|info(?:rmation)?|details|update|link|code)|track\s+your\s+(?:order|package|parcel|shipment|delivery)|your\s+(?:\w+\s+)?(?:package|parcel|delivery|shipment)s?|(?:package|parcel)s?\s+(?:delivered|shipped|update|arriving|(?:is|was|has)\s+(?:on|out|arriv\w*|ready|delivered|shipped|been))|has\s+arrived|arriving\s+(?:today|tomorrow)|ready\s+for\s+(?:pickup|collection)|return\s+label|refund(?:ed)?|exchange\s+request|backorder(?:ed)?|preorder|pre[- ]order)\b|注文|ご購入(?:ありがとう|いただき|手続き|完了|内容)|購入(?:完了|確認|手続き|履歴)|発送|出荷|配達|お届け(?:予定|日|のお知らせ|完了|済)|お荷物|配送状況|領収書|返金/i;

/**
 * Looser wording, safe only once the sender is a known retailer: `confirmation`
 * and `payment received` say nothing about what kind of business sent them,
 * and a shop's bare "shipping" or "package" is about a parcel.
 */
const RETAIL_EXTRA_RE =
  /\b(confirmation|confirmed|payment\s+received|thanks\s+for\s+your\s+order|your\s+cart|subscription\s+(?:renewed|shipment)|shipping|delivery|package|parcel|tracking|your\s+(?:\w+\s+)?tickets?|tickets?\s+(?:confirmed|confirmation|are\s+ready)|e[- ]?tickets?)\b|確認|お届け|配送|チケット/i;

/**
 * Billing wording that belongs to Finance even from a shop-shaped sender.
 * Without this, `no-reply@utility.example` sending "Your invoice is ready"
 * would be filed as a purchase before Finance ever sees it.
 */
const BILLING_NOT_PURCHASE_RE =
  /\b(statement|autopay|auto[- ]pay|past\s+due|payment\s+due|minimum\s+payment|e[- ]statement|direct\s+deposit|overdraft|your\s+bill|bill\s+is\s+ready|billing\s+statement)\b|明細|ご請求|引き?落と?し/i;

/** A product announcing what it built, not a parcel leaving a warehouse. */
const CHANGELOG_RE =
  /\bwe(?:'ve|\s+have|\s+just)?\s+shipped\b|\bnow\s+shipping\b|\bchangelog\b|\brelease\s+notes\b|\bproduct\s+updates?\b/i;

/**
 * What a service on the Updates list has to say before its mail is a
 * purchase. npm publishing a package, GitHub shipping a feature and Toggl's
 * time tracking all trip the strong wording; only the transaction itself
 * counts from these senders.
 */
const SERVICE_PURCHASE_RE =
  /\b(receipt|e[- ]?receipt|invoice|order(?:ed)?|purchase[ds]?|refund(?:ed)?|payment\s+received)\b|領収書|注文|購入/i;

export const isRetailDomain = (domain: string): boolean =>
  domainMatches(domain, RETAIL_DOMAINS);

export const matchesPurchases = (f: Features): boolean => {
  // Japan Post Bank sends from jp-bank.japanpost.jp, under the carrier's
  // domain; Finance lists it and gets it.
  if (domainMatches(f.senderDomain, CARRIER_DOMAINS)) return !isFinanceDomain(f.senderDomain);
  // "Free shipping this weekend" is a campaign that happens to contain a
  // purchase noun. Purchases runs ahead of Promos, so it has to hand those
  // back itself — but only when the message was sent in bulk, so that a real
  // shipping notice relayed over campaign infrastructure still counts.
  if (isBulk(f) && PROMO_SUBJECT_RE.test(f.subject)) return false;
  if (isRetailDomain(f.senderDomain)) {
    return PURCHASE_STRONG_RE.test(f.subject) || RETAIL_EXTRA_RE.test(f.subject);
  }
  if (BILLING_NOT_PURCHASE_RE.test(f.subject)) return false;
  if (CHANGELOG_RE.test(f.subject)) return false;
  const wording = isServiceDomain(f.senderDomain) ? SERVICE_PURCHASE_RE : PURCHASE_STRONG_RE;
  return wording.test(f.subject) && isOrganizationalSender(f);
}

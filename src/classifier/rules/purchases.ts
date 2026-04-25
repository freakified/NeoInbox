import type { Features } from "../features";
import { domainMatches } from "../features";

const RETAIL_DOMAINS = [
  "amazon.com", "amazon.co.uk", "amazon.ca", "amazon.de",
  "amazon.fr", "amazon.co.jp", "amazon.it", "amazon.es",
  "apple.com", "itunes.com",
  "ebay.com", "etsy.com",
  "stripe.com", "squareup.com", "shopify.com",
  "doordash.com", "ubereats.com", "grubhub.com", "instacart.com",
  "postmates.com", "chewy.com",
  "target.com", "walmart.com", "costco.com", "bestbuy.com",
  "homedepot.com", "lowes.com", "ikea.com",
  "nike.com", "adidas.com", "zappos.com", "nordstrom.com",
];

const CARRIER_DOMAINS = [
  "usps.com", "ups.com", "fedex.com", "dhl.com", "ontrac.com",
];

const PURCHASE_SUBJECT_RE =
  /\b(receipt|order|invoice|purchase|shipped|delivered|delivery|tracking|confirmation|shipment|has\s+arrived|out\s+for\s+delivery)\b/i;

export const matchesPurchases = (f: Features): boolean => {
  if (domainMatches(f.senderDomain, CARRIER_DOMAINS)) return true;
  if (domainMatches(f.senderDomain, RETAIL_DOMAINS)) {
    if (PURCHASE_SUBJECT_RE.test(f.subject)) return true;
    return false;
  }
  if (
    PURCHASE_SUBJECT_RE.test(f.subject) &&
    /^(no-?reply|noreply|order|orders|receipt|receipts|shipment|shipping|delivery|store)/.test(
      f.senderLocalPart,
    )
  ) {
    return true;
  }
  return false;
}

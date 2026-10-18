/**
 * The city a stay is in, for naming trips ("Trip to Hakone") and labeling the
 * itinerary ("Stay in Hakone"). Text templates rarely say it outright, but
 * they print the property's address, and an address ends in a city.
 *
 * Only addresses the email presents as the property's count: a line under an
 * "Address"/"Location" label, or a full street address ending in the
 * country. Every Airbnb mail also carries Airbnb's own San Francisco HQ in
 * the footer (Hertz: Oklahoma City, Aramark: Phoenix), so a bare
 * "City, ST 12345" anywhere in the body is the sender, not the stay.
 */
import type { Line } from "./layout";

const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

const STATE_NAMES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho", "illinois",
  "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland",
  "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana",
  "nebraska", "nevada", "new hampshire", "new jersey", "new mexico", "new york",
  "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania",
  "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah",
  "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming",
]);

/** "Address", "ADDRESS", "Property address", "Location | 450 Powell…", "Address 73 104 Aulepe…". */
const LABEL_RE = /^(?:property\s+)?(?:address|location)(?:\s*[:|]\s*|\s+(?=\d)|\s*$)/i;
/** An unlabeled line still counts when it is a whole address, country included. */
const COUNTRY_TAIL_RE = /,\s*(?:the\s+)?(?:united states(?: of america)?|japan)\s*$/i;
const JP_POSTCODE_RE = /\b\d{3}-\d{4}\b/;
const US_ZIP_RE = /^(?:([A-Z]{2})|[A-Z][a-z]+)\s+(?:US\s+)?\d{5}(?:-\d{4})?$/;

/** Everything up to the last street word is the street: "450 Post Street San Francisco". */
const STREET_WORD_RE =
  /^.*\b(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|way|place|pl|court|ct|highway|hwy|suite|ste|unit|#\s*\d+|\d+)\b\.?\s*/i;

const tidy = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // Tōkyō → Tokyo
    .replace(/\s+/g, " ")
    .replace(/[\s,.]+$/, "")
    .trim();

/** A plausible place name: Latin letters, not a street fragment or a number. */
const isPlace = (s: string): boolean =>
  /^[A-Za-z][A-Za-z .'-]{1,40}$/.test(s) && !/\d/.test(s) && !/^(?:japan|usa?)$/i.test(s);

/** "Tōkyō-to" / "Osaka Prefecture" / "Sumida Ward" → the bare name. */
const stripJpSuffix = (s: string): string =>
  s.replace(/(?:-(?:to|fu|ken|shi|ku)|\s+(?:prefecture|ward|city))$/i, "");

/** "…, San Francisco, CA 94109, United States of America" → San Francisco. */
const usCity = (address: string): string | null => {
  const parts = address.split(",").map((p) => p.trim());
  for (let i = parts.length - 1; i > 0; i--) {
    const zip = parts[i]!.match(US_ZIP_RE);
    if (!zip) continue;
    if (zip[1] && !US_STATES.has(zip[1])) continue;
    let city = parts[i - 1]!;
    if (zip[1] === "DC") return "Washington, D.C.";
    // "Island of Hawaii (Kailua-Kona)" names the town in parens; "San
    // Francisco (California)" names the state there instead.
    const paren = city.match(/^(.*?)\s*\(([^)]+)\)$/);
    if (paren) city = STATE_NAMES.has(paren[2]!.toLowerCase()) ? paren[1]! : paren[2]!;
    city = tidy(city.replace(STREET_WORD_RE, ""));
    return isPlace(city) ? city : null;
  }
  // Booking.com receipts: "450 Post Street San Francisco (California), United
  // States of America CA 94102" — the state rides in parens before the country.
  const paren = address.match(/^(.*?)\s*\(([^)]+)\)\s*,/);
  if (paren && STATE_NAMES.has(paren[2]!.toLowerCase())) {
    const city = tidy(paren[1]!.replace(STREET_WORD_RE, ""));
    return isPlace(city) ? city : null;
  }
  return null;
};

/**
 * Japanese addresses, as the senders here print them:
 *   "131-0045, Tokyo, Sumida Ward, …"                (postcode, city, …)
 *   "530-0057 Osaka Prefecture, Osaka, Kita-ku …"    (postcode prefecture, city, …)
 *   "1 Chome-1-2 Oshiage, Sumida-ku, Tōkyō-to 131-0045, Japan"
 *   "Hakata-ku Reisenmachi 8-24 Fukuoka, Japan 812-0039"
 * Tokyo's wards all name the trip "Tokyo", which is what a person would say.
 */
const jpCity = (address: string): string | null => {
  const parts = address.split(",").map((p) => tidy(p));
  const lead = address.match(/^\s*\d{3}-\d{4}\s*(,)?\s*([^,]+),\s*([^,]+)/);
  if (lead) {
    const pick = lead[1] ? lead[2]! : lead[3]!;
    const city = stripJpSuffix(tidy(pick));
    if (isPlace(city)) return city;
  }
  for (let i = 0; i < parts.length; i++) {
    const m = parts[i]!.match(/^(.*?)\s*\d{3}-\d{4}$/);
    if (m && m[1]) {
      const city = stripJpSuffix(tidy(m[1]));
      if (isPlace(city)) return city;
    }
    if (/^japan\b/i.test(parts[i]!) && i > 0) {
      const words = parts[i - 1]!.split(" ");
      const city = stripJpSuffix(words[words.length - 1] ?? "");
      if (isPlace(city)) return city;
    }
  }
  return null;
};

const cityOfAddress = (address: string): string | null =>
  JP_POSTCODE_RE.test(address) || /\bjapan\b/i.test(address)
    ? jpCity(address)
    : usCity(address);

/** Booking.com reminders and Airbnb say it in prose. */
const TRIP_TO_RE = /\b(?:upcoming trip|your trip) to ([A-Z][A-Za-z .'-]{1,40}?)(?:,| in \d+ days?|\.|$)/;

export const findLocality = (lines: readonly Line[]): string | null => {
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.text.trim();
    const label = text.match(LABEL_RE);
    if (label) {
      const rest = text.slice(label[0].length).replace(/\s*Get directions.*$/i, "");
      const candidates = rest ? [rest] : lines.slice(i + 1, i + 3).map((l) => l.text);
      for (const c of candidates) {
        const city = cityOfAddress(c.replace(/\s*(?:Get directions|- Show directions).*$/i, ""));
        if (city) return city;
      }
      continue;
    }
    if (COUNTRY_TAIL_RE.test(text) || /^\d{3}-\d{4}\b/.test(text)) {
      const city = cityOfAddress(text);
      if (city) return city;
    }
  }
  for (const line of lines) {
    const m = line.text.match(TRIP_TO_RE);
    if (m && isPlace(tidy(m[1]!))) return tidy(m[1]!);
  }
  return null;
};

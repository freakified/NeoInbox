import type { Features } from "../features";
import { domainMatches } from "../features";

const FINANCE_DOMAINS = [
  "chase.com", "bankofamerica.com", "wellsfargo.com", "citi.com", "citibank.com",
  "capitalone.com", "usbank.com", "ally.com", "discover.com",
  "amex.com", "americanexpress.com",
  "fidelity.com", "schwab.com", "vanguard.com", "tdameritrade.com", "etrade.com",
  "robinhood.com", "sofi.com", "wealthfront.com", "betterment.com",
  "coinbase.com", "kraken.com", "binance.com", "binance.us", "gemini.com",
  "paypal.com", "venmo.com", "cash.app", "zelle.com",
  "irs.gov", "turbotax.com", "hrblock.com",
  "mint.com", "personalcapital.com", "monarchmoney.com",
];

const FINANCE_SUBJECT_RE =
  /\b(statement|bill|payment|transaction|balance|deposit|withdrawal|transfer|receipt|alert|activity|payment\s+due|auto[- ]?pay)\b/i;

const FINANCE_PROMO_RE =
  /(offer|apply|open\s+account|new\s+card|%\s*apr|%\s*rate|upgrade|refer\s+a\s+friend|reward)/i;

export const matchesFinance = (f: Features): boolean => {
  if (!domainMatches(f.senderDomain, FINANCE_DOMAINS)) return false;
  if (FINANCE_SUBJECT_RE.test(f.subject)) return true;
  if (FINANCE_PROMO_RE.test(f.subject)) return false;
  return true;
}

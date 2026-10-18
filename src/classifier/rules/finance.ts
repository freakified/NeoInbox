/**
 * Money: banks, cards, brokerages, insurers, lenders, tax and payroll.
 *
 * Two ways in. A known financial domain claims everything it sends that isn't
 * an acquisition pitch — these senders are overwhelmingly automated, and their
 * account mail is the mail a person most wants to find. And, off the list, a
 * billing subject from an organisational sender, which is what catches the
 * utility, the landlord, the gym and the insurer whose domain nobody could
 * enumerate.
 */
import type { Features } from "../features";
import { domainMatches } from "../features";
import { isOrganizationalSender } from "../signals";

const FINANCE_DOMAINS = [
  // US banks and credit unions.
  "chase.com", "bankofamerica.com", "bofa.com", "wellsfargo.com", "citi.com",
  "citibank.com", "citicards.com", "capitalone.com", "usbank.com", "pnc.com",
  "truist.com", "suntrust.com", "bbt.com", "regions.com", "53.com",
  "fifththird.com", "huntington.com", "keybank.com", "mtb.com",
  "citizensbank.com", "santanderbank.com", "firstrepublic.com", "comerica.com",
  "zionsbank.com", "synchrony.com", "synchronybank.com", "marcus.com",
  "goldmansachs.com", "ally.com", "discover.com", "amex.com",
  "americanexpress.com", "barclaycardus.com", "usaa.com", "navyfederal.org",
  "penfed.org", "alliantcreditunion.org", "becu.org", "schoolsfirstfcu.org",
  "sofi.com", "chime.com", "varomoney.com", "current.com", "dave.com",
  "upgrade.com", "bluevine.com", "mercury.com", "novo.co", "brex.com",
  "ramp.com", "expensify.com", "divvy.co", "barclaysus.com", "axosbank.com",
  "firstcitizens.com", "frostbank.com", "eastwestbank.com", "svb.com",
  "golden1.com", "firsttechfed.com", "creditonebank.com", "missionlane.com",
  "comenity.net", "breadfinancial.com", "bilt.com", "biltrewards.com",
  // Banks elsewhere.
  "barclays.co.uk", "hsbc.com", "hsbc.co.uk", "lloydsbank.com", "halifax.co.uk",
  "natwest.com", "rbs.co.uk", "santander.co.uk", "nationwide.co.uk",
  "monzo.com", "starlingbank.com", "revolut.com", "n26.com", "bunq.com",
  "wise.com", "transferwise.com", "tdbank.com", "td.com", "bmo.com",
  "bmoharris.com", "rbcroyalbank.com", "rbc.com", "scotiabank.com",
  "cibc.com", "tangerine.ca", "desjardins.com", "commbank.com.au",
  "westpac.com.au", "nab.com.au", "anz.com", "ing.com", "rabobank.nl",
  "deutsche-bank.de", "commerzbank.de", "sparkasse.de", "bnpparibas.com",
  "societegenerale.fr", "creditagricole.fr", "santander.com", "bbva.com",
  "unicredit.eu", "intesasanpaolo.com", "nubank.com.br", "itau.com.br",
  "barclays.com", "chase.co.uk", "firstdirect.com", "tsb.co.uk",
  "metrobankonline.co.uk", "wealthsimple.com", "questrade.com",
  // Brokerages, retirement and equity.
  "fidelity.com", "netbenefits.com", "schwab.com", "vanguard.com",
  "tdameritrade.com", "etrade.com", "merrilledge.com", "ml.com",
  "morganstanley.com", "edwardjones.com", "raymondjames.com", "tiaa.org",
  "voya.com", "principal.com", "empower.com", "empower-retirement.com",
  "johnhancock.com", "robinhood.com", "webull.com", "m1.com", "m1finance.com",
  "public.com", "stash.com", "acorns.com", "interactivebrokers.com",
  "ibkr.com", "tastytrade.com", "tastyworks.com", "wealthfront.com",
  "betterment.com", "computershare.com", "carta.com", "shareworks.com",
  "vestd.com", "fundrise.com", "yieldstreet.com", "transamerica.com",
  "lincolnfinancial.com", "ascensus.com", "guideline.com", "vestwell.com",
  "my529.org", "pershing.com", "hl.co.uk", "trading212.com", "freetrade.io",
  "nutmeg.com", "vanguardinvestor.co.uk",
  // Health savings accounts.
  "healthequity.com", "hsabank.com", "optumbank.com", "livelyme.com",
  // Crypto.
  "coinbase.com", "kraken.com", "binance.com", "binance.us", "gemini.com",
  "crypto.com", "bitstamp.net", "bitfinex.com", "okx.com", "kucoin.com",
  "uphold.com", "ledger.com", "trezor.io", "strike.me", "river.com",
  // Payments, transfers and buy-now-pay-later.
  "paypal.com", "venmo.com", "cash.app", "squarecash.com", "zelle.com",
  "remitly.com", "xoom.com", "westernunion.com", "moneygram.com",
  "payoneer.com", "affirm.com", "klarna.com", "afterpay.com", "sezzle.com",
  "zip.co", "bill.com", "melio.com", "plaid.com", "paypal.co.uk",
  "zellepay.com", "splitwise.com",
  // Credit reporting, lending and student loans.
  "creditkarma.com", "creditsesame.com", "experian.com", "equifax.com",
  "transunion.com", "myfico.com", "annualcreditreport.com",
  "lendingclub.com", "prosper.com", "upstart.com", "avant.com",
  "rocketmortgage.com", "quickenloans.com", "better.com", "lendingtree.com",
  "salliemae.com", "nelnet.net", "navient.com", "mohela.com",
  "aidvantage.com", "mygreatlakes.org", "studentaid.gov", "earnest.com",
  "mrcooper.com", "pennymac.com", "loandepot.com", "newrez.com",
  "freedommortgage.com", "gmfinancial.com", "fordcredit.com",
  "toyotafinancial.com", "hondafinancialservices.com",
  // Insurance (property, casualty, life — health lives in Updates).
  "geico.com", "statefarm.com", "progressive.com", "allstate.com",
  "libertymutual.com", "farmers.com", "travelers.com", "amfam.com",
  "esurance.com", "thehartford.com", "nationwide.com", "erieinsurance.com",
  "lemonade.com", "root.com", "metlife.com", "prudential.com",
  "newyorklife.com", "massmutual.com", "northwesternmutual.com",
  "guardianlife.com", "aflac.com", "mutualofomaha.com", "chubb.com",
  "safeco.com", "hippo.com",
  // Tax, government savings bonds, payroll and accounting.
  "irs.gov", "taxpayeradvocate.irs.gov", "eftps.gov", "treasurydirect.gov",
  "fiscal.treasury.gov", "hmrc.gov.uk", "ato.gov.au", "cra-arc.gc.ca",
  "turbotax.com", "intuit.com",
  "quickbooks.com", "hrblock.com", "taxact.com", "freetaxusa.com",
  "taxslayer.com", "adp.com", "gusto.com", "paychex.com", "workday.com",
  "trinet.com", "justworks.com", "rippling.com", "zenefits.com",
  "waveapps.com", "freshbooks.com", "xero.com", "sage.com",
  // Budgeting.
  "mint.com", "personalcapital.com", "monarchmoney.com", "ynab.com",
  "copilot.money", "rocketmoney.com", "truebill.com", "cointracker.io",
  "koinly.io",
];

const FINANCE_SUBJECT_RE =
  /\b(statement|bill|billing|payment|transaction|balance|deposit|withdrawal|transfer|receipt|alert|activity|payment\s+due|auto[- ]?pay|invoice|dividend|interest|premium|renewal|claim|policy|escrow|mortgage|loan|contribution|portfolio|tax|refund|1099|w[- ]?2|payroll|paystub|pay\s+stub|direct\s+deposit|overdraft|credit\s+score|fraud|dispute|wire|ach|autopay|due\s+date|minimum\s+payment|account\s+summary)\b/i;

const FINANCE_PROMO_RE =
  /(offer|apply|open\s+account|new\s+card|%\s*apr|%\s*rate|upgrade|refer\s+a\s+friend|reward|pre[- ]?approved|earn\s+up\s+to|limited[- ]time|introducing|webinar|survey)/i;

/**
 * Billing wording strong enough to name a category on its own. Deliberately
 * excludes `invoice`, `receipt` and bare `payment`: Purchases runs first and
 * owns those, and a shop's invoice is a purchase, not a bill.
 */
const BILLING_STRONG_RE =
  /\b(statement\s+is\s+ready|statement\s+available|your\s+statement|new\s+statement|e[- ]statement|billing\s+statement|account\s+statement|statement\s+of\s+account|(?:monthly|annual|quarterly|rent)\s+statement|your\s+(?:\w+\s+)?bill\b|bill\s+is\s+ready|rent\s+(?:due|payment|reminder)|payment\s+due|past\s+due|payment\s+reminder|minimum\s+payment|autopay|auto[- ]pay|automatic\s+payment|direct\s+deposit|overdraft|insufficient\s+funds|low\s+balance|account\s+balance|wire\s+transfer|payment\s+(?:posted|processed|failed|declined)|premium\s+(?:due|notice)|policy\s+(?:renewal|documents?)|loan\s+(?:payment|statement)|mortgage\s+(?:payment|statement)|tax\s+(?:return|document|statement)|1099|w[- ]?2\b|payroll|pay\s*stub|credit\s+score)\b/i;

export const isFinanceDomain = (domain: string): boolean =>
  domainMatches(domain, FINANCE_DOMAINS);

export const matchesFinance = (f: Features): boolean => {
  if (isFinanceDomain(f.senderDomain)) {
    if (FINANCE_SUBJECT_RE.test(f.subject)) return true;
    if (FINANCE_PROMO_RE.test(f.subject)) return false;
    return true;
  }
  return BILLING_STRONG_RE.test(f.subject) && isOrganizationalSender(f);
}

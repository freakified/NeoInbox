/**
 * Domains used by many unrelated people (public webmail, ISPs). A domain
 * rule built from one of these would sweep in mail from everyone who
 * happens to share the provider, not just the sender the user meant.
 */
const SHARED_MAILBOX_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "fastmail.com",
  "yandex.com",
  "qq.com",
  "163.com",
  "126.com",
  "naver.com",
  "hanmail.net",
  "daum.net",
  "mail.ru",
  "yandex.ru",
  "hey.com",
  "pm.me",
  "tutanota.com",
  "tuta.io",
  "hotmail.co.uk",
  "live.co.uk",
  "btinternet.com",
  "web.de",
  "t-online.de",
  "orange.fr",
  "free.fr",
  "laposte.net",
  "libero.it",
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "bellsouth.net",
  "cox.net",
  "charter.net",
  "earthlink.net",
  // Japan: webmail and the mobile carriers' own mailboxes.
  "yahoo.co.jp",
  "outlook.jp",
  "hotmail.co.jp",
  "live.jp",
  "docomo.ne.jp",
  "ezweb.ne.jp",
  "softbank.ne.jp",
  "i.softbank.jp",
  "nifty.com",
  "biglobe.ne.jp",
]);

export const isSharedMailboxDomain = (domain: string): boolean =>
  SHARED_MAILBOX_DOMAINS.has(domain.toLowerCase());

/**
 * A domain rule makes sense when the domain belongs to a single
 * organization — a "domain" rule for a shared provider (gmail.com,
 * outlook.com, …) almost never does, so default to the exact sender
 * address there instead.
 */
export const suggestRuleType = (senderDomain: string): "domain" | "email" =>
  isSharedMailboxDomain(senderDomain) ? "email" : "domain";

import { parseSender } from "../shared/senders";

export { domainMatches } from "../shared/routeRules";

export interface Features {
  senderEmail: string;
  senderDomain: string;
  senderLocalPart: string;
  senderName: string;
  subject: string;
  headers: Record<string, string[]>;
  listId?: string;
  hasListPost: boolean;
  hasListUnsubscribe: boolean;
  hasMailingList: boolean;
  /** `Precedence: bulk | list | junk` — a bulk run, not a message to you. */
  bulkPrecedence: boolean;
  /** RFC 3834 `Auto-Submitted:` anything but `no` — generated, not typed. */
  autoSubmitted: boolean;
  /**
   * A bulk-mail platform's fingerprint is on the message — see
   * CAMPAIGN_HEADER_PREFIXES. Derived here rather than in signals.ts because
   * isBulk is asked four times per message and this is the only part of it
   * that costs a header scan.
   */
  campaignHeaders: boolean;
  /**
   * In-Reply-To or References is set: this message is a turn in a thread.
   * Automated senders almost never set these, so together with the absence of
   * list and bulk headers it is the clearest sign of human correspondence.
   */
  isReply: boolean;
}

/**
 * Bulk-sending fingerprints left by mail platforms. Presence means the message
 * was one of many, which is the difference between "your receipt" and "a
 * campaign that mentions receipts".
 *
 * Matched as name prefixes because every platform versions its headers
 * (`x-sg-eid`, `x-sg-id`, `x-mc-user`, `x-mc-api-key` …).
 */
export const CAMPAIGN_HEADER_PREFIXES = [
  "feedback-id",
  "x-feedback-id",
  "x-campaign",
  "x-mailchimp",
  "x-mc-",
  "x-sg-",
  "x-sendgrid",
  "x-ses-",
  "x-mailgun",
  "x-sparkpost",
  "x-msys-api",
  "x-msfbl",
  "x-klaviyo",
  "x-braze",
  "x-iterable",
  "x-sailthru",
  "x-sfmc-",
  "x-emarsys",
  "x-eloqua",
  "x-marketo",
  "x-responsys",
  "x-listrak",
  "x-attentive",
  "x-bluecore",
  "x-cordial",
  "x-ctct",
  "x-constantcontact",
  "x-mandrill",
  "x-bulkmail",
  "x-mailer-campaign",
  "x-newsletter",
];

// Widened from MessageHeader to just the fields actually read, so cached
// RawMessage rows can be run through the travel heuristic without a cast.
export const extractFeatures = (
  header: Pick<messenger.messages.MessageHeader, "author" | "subject">,
  headers: Record<string, string[]>,
): Features => {
  const sender = parseSender(header.author ?? "");

  const lower: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    lower[k.toLowerCase()] = v;
  }

  const precedence = lower["precedence"]?.[0]?.trim().toLowerCase() ?? "";
  const autoSubmitted = lower["auto-submitted"]?.[0]?.trim().toLowerCase() ?? "";
  const names = Object.keys(lower);

  return {
    senderEmail: sender.email,
    senderDomain: sender.domain,
    senderLocalPart: sender.localPart,
    senderName: sender.name,
    subject: header.subject ?? "",
    headers: lower,
    listId: lower["list-id"]?.[0],
    hasListPost: Boolean(lower["list-post"]?.length),
    hasListUnsubscribe: Boolean(lower["list-unsubscribe"]?.length),
    hasMailingList: Boolean(lower["mailing-list"]?.length),
    bulkPrecedence: /^(bulk|list|junk)/.test(precedence),
    autoSubmitted: autoSubmitted !== "" && autoSubmitted !== "no",
    campaignHeaders: namesMatchPrefix(names, CAMPAIGN_HEADER_PREFIXES),
    isReply: Boolean(lower["in-reply-to"]?.length || lower["references"]?.length),
  };
}

const namesMatchPrefix = (names: readonly string[], prefixes: readonly string[]): boolean => {
  for (const name of names) {
    for (const prefix of prefixes) {
      if (name.startsWith(prefix)) return true;
    }
  }
  return false;
}

/** True when any header name starts with one of these prefixes. */
export const hasAnyHeaderPrefix = (f: Features, prefixes: readonly string[]): boolean =>
  namesMatchPrefix(Object.keys(f.headers), prefixes);

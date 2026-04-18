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
}

const ADDR_RE = /<([^>]+)>/;

export function extractFeatures(
  header: messenger.messages.MessageHeader,
  headers: Record<string, string[]>,
): Features {
  const raw = header.author ?? "";
  const m = raw.match(ADDR_RE);
  const email = (m?.[1] ?? raw).trim().toLowerCase();
  const atIdx = email.lastIndexOf("@");
  const senderLocalPart = atIdx >= 0 ? email.slice(0, atIdx) : "";
  const senderDomain = atIdx >= 0 ? email.slice(atIdx + 1) : "";
  const senderName = m
    ? raw
        .slice(0, raw.indexOf("<"))
        .trim()
        .replace(/^"|"$/g, "")
    : "";

  const lower: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    lower[k.toLowerCase()] = v;
  }

  return {
    senderEmail: email,
    senderDomain,
    senderLocalPart,
    senderName,
    subject: header.subject ?? "",
    headers: lower,
    listId: lower["list-id"]?.[0],
    hasListPost: Boolean(lower["list-post"]?.length),
    hasListUnsubscribe: Boolean(lower["list-unsubscribe"]?.length),
    hasMailingList: Boolean(lower["mailing-list"]?.length),
  };
}

export function domainMatches(domain: string, list: readonly string[]): boolean {
  return list.some((d) => domain === d || domain.endsWith("." + d));
}

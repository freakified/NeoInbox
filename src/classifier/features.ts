import { parseSender } from "../shared/senders";

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

export const extractFeatures = (
  header: messenger.messages.MessageHeader,
  headers: Record<string, string[]>,
): Features => {
  const sender = parseSender(header.author ?? "");

  const lower: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    lower[k.toLowerCase()] = v;
  }

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
  };
}

export const domainMatches = (domain: string, list: readonly string[]): boolean => {
  return list.some((d) => domain === d || domain.endsWith("." + d));
}

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
}

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


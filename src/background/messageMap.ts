import { sanitizeTags } from "../shared/categories";
import { messageKeyOf, type MessageKey } from "../shared/messageKey";
import { parseAddressList } from "../shared/senders";
import type { MessageOrigin, RawMessage } from "../shared/types";

type FolderRef = { id?: string; accountId?: string };
type HeaderWithFolder = messenger.messages.MessageHeader & {
  folder?: FolderRef;
};

const normalizeAddressList = (addresses: readonly string[] | undefined): string[] =>
  (addresses ?? []).flatMap(parseAddressList);

/** The row key a header caches under (see messageKey.ts). */
export const keyOfHeader = (header: messenger.messages.MessageHeader): MessageKey => {
  const folder = (header as HeaderWithFolder).folder;
  return messageKeyOf({
    accountId: folder?.accountId ?? "",
    folderId: folder?.id ?? "",
    headerMessageId: header.headerMessageId ?? "",
    date: header.date ? new Date(header.date).getTime() : 0,
    author: header.author ?? "",
    subject: header.subject ?? "",
  });
};

export const headerToRawMessage = (
  header: messenger.messages.MessageHeader,
  origin: MessageOrigin,
): RawMessage => {
  const folder = (header as HeaderWithFolder).folder;
  // Legacy neoinbox-* keys may linger on the server; keep them out of the cache.
  const tags = sanitizeTags(header.tags);

  return {
    key: keyOfHeader(header),
    tbId: header.id,
    headerMessageId: header.headerMessageId ?? "",
    subject: header.subject ?? "",
    author: header.author ?? "",
    recipients: normalizeAddressList(header.recipients),
    ccList: normalizeAddressList(header.ccList),
    bccList: normalizeAddressList(header.bccList),
    date: header.date ? new Date(header.date).getTime() : 0,
    size: header.size ?? 0,
    read: header.read ?? false,
    folderId: folder?.id ?? "",
    accountId: folder?.accountId ?? "",
    tags,
    // Classification state; callers stamp the real values via
    // applyClassification (fresh) or carryClassification (reused).
    category: null,
    // Local-only state; callers stamp the real values via applyLocalState.
    pinned: false,
    snoozed: false,
    origin,
  };
}

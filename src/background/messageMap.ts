import { sanitizeTags } from "../shared/categories";
import { parseAddressList } from "../shared/senders";
import type { Category, MessageOrigin, RawMessage } from "../shared/types";

type FolderRef = { id?: string; accountId?: string };
type HeaderWithFolder = messenger.messages.MessageHeader & {
  folder?: FolderRef;
};

const normalizeAddressList = (addresses: readonly string[] | undefined): string[] =>
  (addresses ?? []).flatMap(parseAddressList);

export const headerToRawMessage = (
  header: messenger.messages.MessageHeader,
  origin: MessageOrigin,
  appliedCategory?: Category | null,
): RawMessage => {
  const folder = (header as HeaderWithFolder).folder;
  // Legacy neoinbox-* keys may linger on the server until cleanupLegacyTags
  // finishes; never let them back into the cache.
  const tags = sanitizeTags(header.tags);
  const category = appliedCategory ?? null;

  return {
    id: header.id,
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
    category,
    // Local-only state; callers stamp the real values via applyLocalState.
    pinned: false,
    snoozed: false,
    origin,
  };
}

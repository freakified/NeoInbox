import { PINNED_KEY } from "../shared/categories";
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
  const baseTags = header.tags ?? [];

  const tags = baseTags;
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
    pinned: tags.includes(PINNED_KEY),
    origin,
  };
}

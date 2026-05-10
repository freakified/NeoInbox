import { PINNED_KEY } from "../shared/categories";
import type { Category, RawMessage } from "../shared/types";

type FolderRef = { id?: string; accountId?: string };
type HeaderWithFolder = messenger.messages.MessageHeader & {
  folder?: FolderRef;
};

export const headerToRawMessage = (
  header: messenger.messages.MessageHeader,
  origin: "inbox" | "sent",
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
    recipients: header.recipients ?? [],
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

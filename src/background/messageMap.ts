import {
  CATEGORIES,
  NEO_TAG_KEYS,
  PINNED_KEY,
  categoryFromTags,
} from "../shared/categories";
import type { Category, RawMessage } from "../shared/types";

type FolderRef = { id?: string; accountId?: string };
type HeaderWithFolder = messenger.messages.MessageHeader & {
  folder?: FolderRef;
};

export function headerToRawMessage(
  header: messenger.messages.MessageHeader,
  origin: "inbox" | "sent",
  appliedCategory?: Category | null,
): RawMessage {
  const folder = (header as HeaderWithFolder).folder;
  const baseTags = header.tags ?? [];
  const tags = appliedCategory
    ? [
        ...baseTags.filter((t) => !NEO_TAG_KEYS.has(t)),
        CATEGORIES[appliedCategory].key,
      ]
    : baseTags;
  return {
    id: header.id,
    subject: header.subject ?? "",
    author: header.author ?? "",
    recipients: header.recipients ?? [],
    date: header.date ? new Date(header.date).getTime() : 0,
    read: header.read ?? false,
    folderId: folder?.id ?? "",
    accountId: folder?.accountId ?? "",
    tags,
    category: categoryFromTags(tags),
    pinned: tags.includes(PINNED_KEY),
    origin,
  };
}

import {
  CATEGORIES,
  NEO_TAG_KEYS,
  PINNED_KEY,
  categoryFromTags,
  type CategoryMeta,
} from "../shared/categories";
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

  let tags = baseTags;
  let category: Category | null;

  if (appliedCategory !== undefined) {
    category = appliedCategory;
    const meta = appliedCategory
      ? (CATEGORIES as Record<string, CategoryMeta | undefined>)[appliedCategory]
      : undefined;
    if (meta?.key) {
      tags = [...baseTags.filter((t) => !NEO_TAG_KEYS.has(t)), meta.key];
    }
  } else {
    category = categoryFromTags(tags);
  }

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
    category,
    pinned: tags.includes(PINNED_KEY),
    origin,
  };
}

import { classify } from "../classifier/pipeline";
import { extractFeatures } from "../classifier/features";
import {
  CATEGORIES,
  NEO_TAG_KEYS,
  PINNED_KEY,
  categoryFromTags,
} from "../shared/categories";
import { log } from "../shared/log";
import { scanCidRefs } from "../spa/lib/srcdoc";
import type { AttachmentSummary, Category } from "../shared/types";

export const classifyAndTag = async (
  header: messenger.messages.MessageHeader,
): Promise<Category | null> => {
  const existing = categoryFromTags(header.tags);
  if (existing) return existing;

  let headers: Record<string, string[]> = {};
  try {
    const full = await messenger.messages.getFull(header.id);
    headers = full.headers ?? {};
  } catch (e) {
    log.debug("ingest", "getFull failed", { id: header.id, e });
  }

  const features = extractFeatures(header, headers);
  const category = await classify(features);
  if (!category) return null;

  const meta = (CATEGORIES as Record<string, typeof CATEGORIES[keyof typeof CATEGORIES] | undefined>)[category];
  if (!meta?.key) return category;

  try {
    await messenger.messages.update(header.id, {
      tags: [...header.tags.filter((t) => !NEO_TAG_KEYS.has(t)), meta.key],
    });
  } catch (e) {
    log.warn("ingest", "tag update failed", { id: header.id, e });
  }
  return category;
}

export const pinMessage = async (id: number, pinned: boolean): Promise<void> => {
  const msg = await messenger.messages.get(id);
  const tags = msg.tags ?? [];
  const next = pinned
    ? [...tags.filter((t) => t !== PINNED_KEY), PINNED_KEY]
    : tags.filter((t) => t !== PINNED_KEY);
  await messenger.messages.update(id, { tags: next });
}

export const doneMessage = async (id: number): Promise<void> => {
  await messenger.messages.archive([id]);
}

export const trashMessage = async (id: number): Promise<void> => {
  await messenger.messages.delete([id], false);
}

export const extractAttachments = async (
  messageId: number,
): Promise<AttachmentSummary[]> => {
  let list: messenger.messages.MessageAttachment[];
  try {
    list = await messenger.messages.listAttachments(messageId);
  } catch {
    return [];
  }
  if (list.length === 0) return [];

  let cidRefs = new Set<string>();
  try {
    const full = await messenger.messages.getFull(messageId);
    cidRefs = scanCidRefs(full);
  } catch {
    /* no body available; render every attachment as a card */
  }

  return list
    .filter((a) => !isCidReferenced(cidRefs, a.name))
    .map((a) => ({
      name: a.name,
      contentType: a.contentType,
      size: a.size,
      partName: a.partName,
    }));
}

const isCidReferenced = (cidRefs: Set<string>, name: string): boolean => {
  if (cidRefs.size === 0 || !name) return false;
  const lower = name.toLowerCase();
  for (const ref of cidRefs) {
    const localPart = ref.split("@")[0] ?? ref;
    if (localPart === lower) return true;
  }
  return false;
}

import { classify } from "../classifier/pipeline";
import { extractFeatures } from "../classifier/features";
import {
  CATEGORIES,
  NEO_TAG_KEYS,
  PINNED_KEY,
  categoryFromTags,
} from "../shared/categories";
import type { Category } from "../shared/types";

export async function classifyAndTag(
  header: messenger.messages.MessageHeader,
): Promise<Category | null> {
  const existing = categoryFromTags(header.tags);
  if (existing) return existing;

  let headers: Record<string, string[]> = {};
  try {
    const full = await messenger.messages.getFull(header.id);
    headers = full.headers ?? {};
  } catch (e) {
    console.debug("[NeoInbox] getFull failed", header.id, e);
  }

  const features = extractFeatures(header, headers);
  const category = await classify(features);
  if (!category) return null;

  const meta = CATEGORIES[category];
  if (!meta.key) return category;

  try {
    await messenger.messages.update(header.id, {
      tags: [...header.tags.filter((t) => !NEO_TAG_KEYS.has(t)), meta.key],
    });
  } catch (e) {
    console.warn("[NeoInbox] tag update failed", header.id, e);
  }
  return category;
}

export async function pinMessage(id: number, pinned: boolean): Promise<void> {
  const msg = await messenger.messages.get(id);
  const tags = msg.tags ?? [];
  const next = pinned
    ? [...tags.filter((t) => t !== PINNED_KEY), PINNED_KEY]
    : tags.filter((t) => t !== PINNED_KEY);
  await messenger.messages.update(id, { tags: next });
}

export async function doneMessage(id: number): Promise<void> {
  await messenger.messages.archive([id]);
}

export async function trashMessage(id: number): Promise<void> {
  await messenger.messages.delete([id], false);
}

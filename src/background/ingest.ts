import { classify } from "../classifier/pipeline";
import { extractFeatures } from "../classifier/features";
import {
  CATEGORIES,
  NEO_TAG_KEYS,
  PINNED_KEY,
  categoryFromTags,
} from "../shared/categories";
import type { Category } from "../shared/types";
import { collectInboxFolders } from "../shared/folders";
import { ensureTagsRegistered } from "./tags";

const BACKFILL_LIMIT = 500;
const PROGRESS_EVERY = 50;

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
  const category = classify(features);
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

export async function doneMessage(
  id: number,
  accountId: string,
): Promise<void> {
  const archiveId = await findArchiveFolder(accountId);
  if (!archiveId) {
    console.warn("[NeoInbox] no archive folder for account", accountId);
    return;
  }
  await messenger.messages.move([id], archiveId);
}

async function findArchiveFolder(accountId: string): Promise<string | null> {
  try {
    const account = await messenger.accounts.get(accountId);
    if (!account) return null;
    let found: string | null = null;
    const walk = (folders: messenger.folders.MailFolder[]) => {
      for (const f of folders) {
        if (found) return;
        if (
          f.specialUse?.includes("archive") ||
          (f as unknown as { type?: string }).type === "archive"
        ) {
          found = f.id ?? null;
          return;
        }
        if (f.subFolders) walk(f.subFolders);
      }
    };
    walk(account.folders ?? []);
    return found;
  } catch (e) {
    console.warn("[NeoInbox] findArchiveFolder failed", e);
    return null;
  }
}

export function wireNewMailHandler(): void {
  messenger.messages.onNewMailReceived.addListener(async (_folder, list) => {
    for (const m of list.messages) {
      await classifyAndTag(m);
    }
  });
}

export async function backfillInbox(): Promise<{
  scanned: number;
  tagged: number;
}> {
  await ensureTagsRegistered();
  const inboxes = await collectInboxFolders();
  console.info(
    `[NeoInbox] backfill start — ${inboxes.length} inbox folder(s), limit=${BACKFILL_LIMIT}`,
  );

  let scanned = 0;
  let tagged = 0;
  outer: for (const folder of inboxes) {
    let page = await messenger.messages.list(folder.id);
    while (true) {
      for (const m of page.messages) {
        if (scanned >= BACKFILL_LIMIT) break outer;
        scanned++;
        const before = categoryFromTags(m.tags);
        const cat = await classifyAndTag(m);
        if (cat && !before) tagged++;
        if (scanned % PROGRESS_EVERY === 0) {
          console.info(
            `[NeoInbox] backfill progress: ${tagged}/${scanned} tagged`,
          );
        }
      }
      if (!page.id) break;
      page = await messenger.messages.continueList(page.id);
    }
  }
  console.info(`[NeoInbox] backfill done: ${tagged}/${scanned} tagged`);
  return { scanned, tagged };
}

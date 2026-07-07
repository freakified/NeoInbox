import {
  LEGACY_PINNED_KEY,
  NEO_TAG_KEYS,
  sanitizeTags,
} from "../shared/categories";
import { pinKeyOf } from "../shared/pinKey";
import { log } from "../shared/log";
import { setPinned } from "./localState";

/**
 * One-time repair: older NeoInbox versions registered neoinbox-* keys in
 * Thunderbird's tag registry and tagged real messages with them (pin/snooze
 * markers, synced to the server as IMAP keywords). That state now lives only
 * in the extension's own database, so this strips our keys from every tagged
 * message — seeding pin records from the legacy pinned tag first — and then
 * drops the keys from the registry. These are the last tag writes NeoInbox
 * ever performs, and they only remove what NeoInbox itself created.
 */

const CLEANUP_FLAG = "legacyTagCleanupDone";

type TagRegistry = {
  list?: () => Promise<{ key: string }[]>;
  delete?: (key: string) => Promise<unknown>;
};

type MessageListLike = {
  id?: string | null;
  messages?: messenger.messages.MessageHeader[];
};

const resolveRegistry = (): TagRegistry => {
  const ns = (messenger.messages as unknown as { tags?: TagRegistry }).tags;
  const legacy = messenger.messages as unknown as {
    listTags?: TagRegistry["list"];
    deleteTag?: TagRegistry["delete"];
  };
  return {
    list: ns?.list?.bind(ns) ?? legacy.listTags?.bind(messenger.messages),
    delete: ns?.delete?.bind(ns) ?? legacy.deleteTag?.bind(messenger.messages),
  };
};

const collectTaggedMessages = async (
  key: string,
): Promise<messenger.messages.MessageHeader[]> => {
  const headers: messenger.messages.MessageHeader[] = [];
  let page = (await messenger.messages.query({
    tags: { mode: "any", tags: { [key]: true } },
  })) as MessageListLike;
  while (true) {
    headers.push(...(page.messages ?? []));
    if (!page.id) return headers;
    page = (await messenger.messages.continueList(page.id)) as MessageListLike;
  }
};

/** Returns false when some messages could not be stripped (retry next run). */
const stripKeyFromMessages = async (key: string): Promise<boolean> => {
  let headers: messenger.messages.MessageHeader[];
  try {
    headers = await collectTaggedMessages(key);
  } catch (e) {
    log.warn("legacy-tags", "query by tag failed", { key, e: String(e) });
    return false;
  }

  let ok = true;
  for (const header of headers) {
    try {
      if (key === LEGACY_PINNED_KEY) {
        await setPinned(
          pinKeyOf({ headerMessageId: header.headerMessageId ?? "", id: header.id }),
          true,
        );
      }
      await messenger.messages.update(header.id, {
        tags: sanitizeTags(header.tags),
      });
    } catch (e) {
      ok = false;
      log.warn("legacy-tags", "strip failed for message", {
        key,
        id: header.id,
        e: String(e),
      });
    }
  }
  if (headers.length) {
    log.info("legacy-tags", `stripped ${key} from ${headers.length} messages`);
  }
  return ok;
};

export const cleanupLegacyTags = async (): Promise<void> => {
  const stored = await messenger.storage.local.get(CLEANUP_FLAG);
  if (stored[CLEANUP_FLAG]) return;

  // Strip messages before touching the registry: deleting a registry key
  // first would make query-by-tag stop matching while the keyword stays
  // behind on the server.
  let strippedAll = true;
  for (const key of NEO_TAG_KEYS) {
    strippedAll = (await stripKeyFromMessages(key)) && strippedAll;
  }

  const registry = resolveRegistry();
  if (registry.list && registry.delete) {
    try {
      const existing = await registry.list();
      for (const tag of existing) {
        if (!NEO_TAG_KEYS.has(tag.key)) continue;
        try {
          await registry.delete(tag.key);
          log.info("legacy-tags", "removed tag from registry", tag.key);
        } catch (e) {
          log.warn("legacy-tags", "registry delete failed", { key: tag.key, e: String(e) });
        }
      }
    } catch (e) {
      log.warn("legacy-tags", "registry list failed", e);
    }
  } else {
    log.warn("legacy-tags", "tag registry delete unavailable; leaving registry entries");
  }

  if (strippedAll) {
    await messenger.storage.local.set({ [CLEANUP_FLAG]: true });
    log.info("legacy-tags", "cleanup complete");
  } else {
    log.warn("legacy-tags", "cleanup incomplete; will retry next startup");
  }
};

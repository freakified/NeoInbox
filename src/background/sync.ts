import { applyMessageDetailsForOrigin, classifyMessage } from "./ingest";
import { headerToRawMessage } from "./messageMap";
import { broadcast } from "./port";
import { db } from "../store/db";
import { SNOOZED_KEY } from "../shared/categories";
import { collectArchiveFolders, collectDraftFolders, collectInboxFolders, collectSentFolders } from "../shared/folders";
import { log } from "../shared/log";
import type { MessageOrigin, RawMessage } from "../shared/types";

type MessageList = { id?: string; messages: { id: number }[] };

type OnUpdatedApi = {
  addListener: (
    cb: (
      message: messenger.messages.MessageHeader,
      changedProperties: { tags?: string[]; read?: boolean },
    ) => void,
  ) => void;
};

type OnDeletedApi = {
  addListener: (cb: (messages: MessageList) => void) => void;
};

type OnMovedApi = {
  addListener: (
    cb: (originalMessages: MessageList, movedMessages: MessageList) => void,
  ) => void;
};

const sendingDraftByTabId = new Map<number, number>();

const idsFromList = (list: MessageList | undefined): number[] =>
  (list?.messages ?? []).map((m) => m.id);

const tabIdOf = (tab: messenger.tabs.Tab): number | undefined => tab.id;

const folderIdOf = (header: messenger.messages.MessageHeader): string => {
  return (
    header as messenger.messages.MessageHeader & {
      folder?: { id?: string };
    }
  ).folder?.id ?? "";
};

const getFolderIds = async (
  collect: () => Promise<{ id: string }[]>,
): Promise<Set<string>> => {
  try {
    return new Set((await collect()).map((f) => f.id));
  } catch (e) {
    log.warn("sync", "folder lookup failed", e);
    return new Set();
  }
};

const cacheMessages = async (
  headers: readonly messenger.messages.MessageHeader[],
  origin: MessageOrigin,
): Promise<RawMessage[]> => {
  const out: RawMessage[] = [];
  for (const header of headers) {
    try {
      const fresh = await messenger.messages.get(header.id);
      const logicalOrigin = origin === "done" && (fresh.tags ?? []).includes(SNOOZED_KEY)
        ? "inbox"
        : origin;
      const cat = logicalOrigin === "inbox" ? await classifyMessage(fresh) : null;
      const raw = headerToRawMessage(fresh, logicalOrigin, cat);
      const cached = await db.messages.get(fresh.id);
      await applyMessageDetailsForOrigin(raw, cached);
      out.push(raw);
    } catch (e) {
      log.warn("sync", "cacheMessages per-msg failed", {
        id: header.id,
        origin,
        e,
      });
    }
  }
  if (out.length) await db.messages.bulkPut(out);
  return out;
};

const originForFolder = async (folderId: string): Promise<MessageOrigin | undefined> => {
  const [inboxIds, sentIds, draftIds, archiveIds] = await Promise.all([
    getFolderIds(collectInboxFolders),
    getFolderIds(collectSentFolders),
    getFolderIds(collectDraftFolders),
    getFolderIds(collectArchiveFolders),
  ]);
  if (sentIds.has(folderId)) return "sent";
  if (draftIds.has(folderId)) return "draft";
  if (archiveIds.has(folderId)) return "done";
  if (inboxIds.has(folderId)) return "inbox";
  return undefined;
};

const removeSentDraft = async (draftId: number): Promise<void> => {
  const cached = await db.messages.get(draftId);
  if (cached && cached.origin !== "draft") return;

  try {
    const header = await messenger.messages.get(draftId);
    if (!cached) {
      const origin = await originForFolder(folderIdOf(header));
      if (origin !== "draft") return;
    }
    await messenger.messages.delete([draftId], true);
  } catch (e) {
    log.debug("sync", "sent draft was already gone or could not be deleted", {
      draftId,
      e: String(e),
    });
  }

  if (await db.messages.get(draftId)) {
    await db.messages.delete(draftId);
    broadcast({ type: "delta", removedIds: [draftId] });
  }
};

export const wireSyncEngine = (): void => {
  messenger.messages.onNewMailReceived.addListener(async (_folder, list) => {
    try {
      const added = await cacheMessages(list.messages, "inbox");
      if (!added.length) return;
      broadcast({ type: "delta", added });
    } catch (e) {
      log.error("sync", "onNewMail flush failed", e);
    }
  });

  const onAfterSend = messenger.compose?.onAfterSend;
  if (onAfterSend) {
    onAfterSend.addListener(async (tab, sendInfo) => {
      const tabId = tabIdOf(tab);
      const sentDraftId = tabId === undefined ? undefined : sendingDraftByTabId.get(tabId);
      if (tabId !== undefined) sendingDraftByTabId.delete(tabId);

      try {
        if (sendInfo.error) {
          log.warn("sync", "onAfterSend reported error", sendInfo.error);
          return;
        }
        const added = await cacheMessages(sendInfo.messages ?? [], "sent");
        if (added.length) {
          broadcast({ type: "delta", added });
          log.debug("sync", `onAfterSend added ${added.length} sent copies`);
        }
        if (sentDraftId !== undefined) await removeSentDraft(sentDraftId);
      } catch (e) {
        log.warn("sync", "onAfterSend failed", e);
      }
    });
  } else {
    log.warn("sync", "compose.onAfterSend unavailable");
  }

  const onAfterSave = messenger.compose?.onAfterSave;
  if (onAfterSave) {
    onAfterSave.addListener(async (_tab, saveInfo) => {
      try {
        if (saveInfo.error) {
          log.warn("sync", "onAfterSave reported error", saveInfo.error);
          return;
        }
        if (saveInfo.mode === "template") return;
        const added = await cacheMessages(saveInfo.messages ?? [], "draft");
        if (!added.length) return;
        broadcast({ type: "delta", added });
        log.debug("sync", `onAfterSave added ${added.length} draft copies`);
      } catch (e) {
        log.warn("sync", "onAfterSave failed", e);
      }
    });
  } else {
    log.warn("sync", "compose.onAfterSave unavailable");
  }

  const onBeforeSend = messenger.compose?.onBeforeSend;
  if (onBeforeSend) {
    onBeforeSend.addListener((tab, details) => {
      const tabId = tabIdOf(tab);
      if (tabId === undefined) return {};
      if (details.type === "draft" && details.relatedMessageId !== undefined) {
        sendingDraftByTabId.set(tabId, details.relatedMessageId);
      } else {
        sendingDraftByTabId.delete(tabId);
      }
      return {};
    });
  } else {
    log.warn("sync", "compose.onBeforeSend unavailable");
  }

  const onUpdated = (
    messenger.messages as unknown as { onUpdated?: OnUpdatedApi }
  ).onUpdated;
  if (onUpdated) {
    onUpdated.addListener(async (header) => {
      try {
        const fresh = await messenger.messages.get(header.id);
        const cached = await db.messages.get(header.id);
        let origin = cached?.origin;
        if (!origin) {
          const folderId = folderIdOf(fresh);
          origin = await originForFolder(folderId);
        }
        if (!origin) return;
        const logicalOrigin = origin === "done" && (fresh.tags ?? []).includes(SNOOZED_KEY)
          ? "inbox"
          : origin;
        const category = cached
          ? cached.category
          : logicalOrigin === "inbox"
            ? await classifyMessage(fresh)
            : null;
        const raw = headerToRawMessage(fresh, logicalOrigin, category);
        await applyMessageDetailsForOrigin(raw, cached);
        await db.messages.put(raw);
        broadcast({ type: "delta", updated: [raw] });
      } catch (e) {
        log.warn("sync", "onUpdated failed", { id: header.id, e });
      }
    });
  } else {
    log.warn("sync", "messages.onUpdated unavailable");
  }

  const onDeleted = (messenger.messages as unknown as { onDeleted?: OnDeletedApi }).onDeleted;
  if (onDeleted) {
    onDeleted.addListener(async (messages) => {
      try {
        const ids = idsFromList(messages);
        if (!ids.length) return;
        const removedIds = [];
        for (const id of ids) {
          if (await db.snoozes.get(id)) continue;
          removedIds.push(id);
        }
        if (!removedIds.length) return;
        await db.messages.bulkDelete(removedIds);
        broadcast({ type: "delta", removedIds });
        log.debug("sync", `onDeleted removed ${removedIds.length}`);
      } catch (e) {
        log.warn("sync", "onDeleted failed", e);
      }
    });
  } else {
    log.warn("sync", "messages.onDeleted unavailable");
  }

  const onMoved = (messenger.messages as unknown as { onMoved?: OnMovedApi }).onMoved;
  if (onMoved) {
    onMoved.addListener(async (originalMessages, movedMessages) => {
      try {
        const ids = idsFromList(originalMessages);
        if (!ids.length) return;
        const byOrigin = new Map<MessageOrigin, messenger.messages.MessageHeader[]>();
        const snoozedOriginalIds = new Set<number>();
        for (let idx = 0; idx < (movedMessages.messages ?? []).length; idx++) {
          const moved = movedMessages.messages[idx]!;
          const originalId = originalMessages.messages[idx]?.id;
          const isKnownSnooze = originalId !== undefined && !!(await db.snoozes.get(originalId));
          if (isKnownSnooze) {
            snoozedOriginalIds.add(originalId);
            continue;
          }
          const fresh = await messenger.messages.get(moved.id);
          if ((fresh.tags ?? []).includes(SNOOZED_KEY)) {
            if (originalId !== undefined) snoozedOriginalIds.add(originalId);
            continue;
          }
          const origin = await originForFolder(folderIdOf(fresh));
          if (!origin) continue;
          const arr = byOrigin.get(origin) ?? [];
          arr.push(fresh);
          byOrigin.set(origin, arr);
        }
        const removedIds = ids.filter((id) => !snoozedOriginalIds.has(id));
        if (removedIds.length) {
          await db.messages.bulkDelete(removedIds);
          broadcast({ type: "delta", removedIds });
        }
        const added = [];
        for (const [origin, headers] of byOrigin) {
          added.push(...await cacheMessages(headers, origin));
        }
        if (added.length) broadcast({ type: "delta", added });
        log.debug("sync", `onMoved removed ${removedIds.length}, cached ${added.length} moved messages`);
      } catch (e) {
        log.warn("sync", "onMoved failed", e);
      }
    });
  } else {
    log.warn("sync", "messages.onMoved unavailable");
  }
};

export const pushMyEmails = async (): Promise<void> => {
  const accounts = await messenger.accounts.list();
  const emails: string[] = [];
  for (const acc of accounts) {
    const identities = (
      acc as unknown as { identities?: { email?: string }[] }
    ).identities ?? [];
    for (const id of identities) {
      if (id.email) emails.push(id.email.toLowerCase());
    }
  }
  broadcast({ type: "myEmails", emails });
};

import { applyMessageDetails, classifyMessage } from "./ingest";
import { headerToRawMessage } from "./messageMap";
import { broadcast } from "./port";
import { db } from "../store/db";
import { log } from "../shared/log";
import type { RawMessage } from "../shared/types";

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

const idsFromList = (list: MessageList | undefined): number[] =>
  (list?.messages ?? []).map((m) => m.id);

export const wireSyncEngine = (): void => {
  messenger.messages.onNewMailReceived.addListener(async (_folder, list) => {
    const added: RawMessage[] = [];
    for (const header of list.messages) {
      try {
        const cat = await classifyMessage(header);
        const fresh = await messenger.messages.get(header.id);
        const raw = headerToRawMessage(fresh, "inbox", cat);
        await applyMessageDetails(raw);
        added.push(raw);
      } catch (e) {
        log.warn("sync", "onNewMail per-msg failed", { id: header.id, e });
      }
    }
    try {
      if (!added.length) return;
      await db.messages.bulkPut(added);
      broadcast({ type: "delta", added });
    } catch (e) {
      log.error("sync", "onNewMail flush failed", e);
    }
  });

  const onUpdated = (
    messenger.messages as unknown as { onUpdated?: OnUpdatedApi }
  ).onUpdated;
  if (onUpdated) {
    onUpdated.addListener(async (header) => {
      try {
        const fresh = await messenger.messages.get(header.id);
        const cached = await db.messages.get(header.id);
        const origin = cached?.origin ?? "inbox";
        const category = cached
          ? cached.category
          : origin === "inbox"
            ? await classifyMessage(fresh)
            : null;
        const raw = headerToRawMessage(fresh, origin, category);
        await applyMessageDetails(raw, cached);
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
        await db.messages.bulkDelete(ids);
        broadcast({ type: "delta", removedIds: ids });
        log.debug("sync", `onDeleted removed ${ids.length}`);
      } catch (e) {
        log.warn("sync", "onDeleted failed", e);
      }
    });
  } else {
    log.warn("sync", "messages.onDeleted unavailable");
  }

  const onMoved = (messenger.messages as unknown as { onMoved?: OnMovedApi }).onMoved;
  if (onMoved) {
    onMoved.addListener(async (originalMessages) => {
      try {
        const ids = idsFromList(originalMessages);
        if (!ids.length) return;
        await db.messages.bulkDelete(ids);
        broadcast({ type: "delta", removedIds: ids });
        log.debug("sync", `onMoved removed ${ids.length} (re-added on next sync if still in inbox)`);
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

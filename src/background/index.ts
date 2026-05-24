import {
  applyMessageDetails,
  classifyMessage,
  doneMessage,
  pinMessage,
  trashMessage,
} from "./ingest";
import { headerToRawMessage } from "./messageMap";
import { handleSnoozeAlarm, snoozeMessage } from "./snooze";
import { getLastProgress, runBackfill, reclassifyAll } from "./backfill";
import { pushMyEmails, wireSyncEngine } from "./sync";
import { broadcast, onCommand, startPortServer } from "./port";
import { setOverride } from "../classifier/overrides";
import { db } from "../store/db";
import { collectArchiveFolders } from "../shared/folders";
import { SNOOZED_KEY } from "../shared/categories";
import { log } from "../shared/log";

const INBOX_URL = "inbox.html";

const extractDomain = (author: string): string => {
  const m = author.match(/<([^>]+)>/);
  const email = (m?.[1] ?? author).toLowerCase();
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "";
}

const openOrFocusInbox = async (): Promise<void> => {
  const tabs = await messenger.tabs.query({});
  const existing = tabs.find((t) => t.url?.endsWith(`/${INBOX_URL}`));
  if (existing?.id !== undefined) {
    await messenger.tabs.update(existing.id, { active: true });
    return;
  }
  await messenger.tabs.create({ url: INBOX_URL });
}

const folderIdOf = (header: messenger.messages.MessageHeader): string => {
  return (
    header as messenger.messages.MessageHeader & {
      folder?: { id?: string };
    }
  ).folder?.id ?? "";
}

const isArchiveFolder = async (folderId: string): Promise<boolean> => {
  if (!folderId) return false;
  const folders = await collectArchiveFolders();
  return folders.some((folder) => folder.id === folderId);
}

const removeCachedSnoozedCopies = async (raw: { id: number; headerMessageId: string }): Promise<void> => {
  if (!raw.headerMessageId) return;
  const staleIds = (await db.messages.toArray())
    .filter((m) =>
      m.id !== raw.id &&
      m.headerMessageId === raw.headerMessageId &&
      m.tags.includes(SNOOZED_KEY)
    )
    .map((m) => m.id);
  if (!staleIds.length) return;
  await db.messages.bulkDelete(staleIds);
  broadcast({ type: "delta", removedIds: staleIds });
}

messenger.browserAction.onClicked.addListener(() => {
  void openOrFocusInbox();
});

messenger.runtime.onInstalled.addListener((details) => {
  log.info("background", "onInstalled", details.reason);
  void runBackfill().catch((e) => log.warn("backfill", "failed", e));
});

messenger.runtime.onStartup.addListener(() => {
  void runBackfill().catch((e) => log.warn("backfill", "failed", e));
});

messenger.alarms.onAlarm.addListener(async (alarm) => {
  const result = await handleSnoozeAlarm(alarm.name);
  if (!result) return;
  if (result.restoredHeader) {
    const cat = await classifyMessage(result.restoredHeader);
    const raw = headerToRawMessage(result.restoredHeader, "inbox", cat);
    await applyMessageDetails(raw);
    if (result.originalId !== raw.id) {
      await db.messages.delete(result.originalId);
      broadcast({ type: "delta", removedIds: [result.originalId] });
    }
    await removeCachedSnoozedCopies(raw);
    await db.messages.put(raw);
    broadcast({ type: "delta", added: [raw] });
  } else {
    await db.messages.delete(result.originalId);
    broadcast({ type: "delta", removedIds: [result.originalId] });
  }
});

wireSyncEngine();
startPortServer();

onCommand(async (msg) => {
  switch (msg.type) {
    case "hello": {
      await pushMyEmails();
      const last = getLastProgress();
      if (last) broadcast(last);
      return;
    }
    case "retry-backfill": {
      void runBackfill().catch((e) => log.warn("backfill", "retry failed", e));
      return;
    }
    case "pin": {
      await pinMessage(msg.messageId, msg.pinned);
      const header = await messenger.messages.get(msg.messageId);
      const cached = await db.messages.get(msg.messageId);
      const raw = headerToRawMessage(
        header,
        cached?.origin ?? "inbox",
        cached?.category ?? null,
      );
      await applyMessageDetails(raw, cached);
      await db.messages.put(raw);
      broadcast({ type: "delta", updated: [raw] });
      return;
    }
    case "done": {
      const cached = await db.messages.get(msg.messageId);
      try {
        await doneMessage(msg.messageId);
      } catch (e) {
        log.warn("command", "done failed", { id: msg.messageId, e: String(e) });
        broadcast({
          type: "command-failed",
          command: "done",
          messageId: msg.messageId,
          reason: String((e as Error)?.message ?? e),
        });
        return;
      }
      try {
        const header = await messenger.messages.get(msg.messageId);
        if (await isArchiveFolder(folderIdOf(header))) {
          const raw = headerToRawMessage(header, "done", cached?.category ?? null);
          await applyMessageDetails(raw, cached);
          await db.messages.put(raw);
          broadcast({ type: "delta", added: [raw] });
          return;
        }
      } catch {
        /* The move may have assigned a new message id; onMoved/backfill will cache it. */
      }
      await db.messages.delete(msg.messageId);
      broadcast({ type: "delta", removedIds: [msg.messageId] });
      return;
    }
    case "trash": {
      try {
        await trashMessage(msg.messageId);
      } catch (e) {
        log.warn("command", "trash failed", { id: msg.messageId, e: String(e) });
        broadcast({
          type: "command-failed",
          command: "trash",
          messageId: msg.messageId,
          reason: String((e as Error)?.message ?? e),
        });
        return;
      }
      await db.messages.delete(msg.messageId);
      broadcast({ type: "delta", removedIds: [msg.messageId] });
      return;
    }
    case "snooze": {
      let removedId: number;
      const cached = await db.messages.get(msg.messageId);
      try {
        ({ removedId } = await snoozeMessage(msg.messageId, msg.wakeAt));
      } catch (e) {
        log.warn("command", "snooze failed", { id: msg.messageId, e: String(e) });
        broadcast({
          type: "command-failed",
          command: "snooze",
          messageId: msg.messageId,
          reason: String((e as Error)?.message ?? e),
        });
        return;
      }
      if (cached) {
        const raw = {
          ...cached,
          tags: [...cached.tags.filter((t) => t !== SNOOZED_KEY), SNOOZED_KEY],
          origin: "inbox" as const,
        };
        await db.messages.put(raw);
        broadcast({ type: "delta", updated: [raw] });
      } else {
        await db.messages.delete(removedId);
        broadcast({ type: "delta", removedIds: [removedId] });
      }
      return;
    }
    case "override": {
      await setOverride(msg.senderDomain, msg.category);
      const wantedDomain = msg.senderDomain.toLowerCase();
      const cached = (await db.messages.toArray()).filter(
        (m) => m.origin === "inbox" && extractDomain(m.author) === wantedDomain,
      );
      const updated = [];
      for (const cmsg of cached) {
        try {
          const header = await messenger.messages.get(cmsg.id);
          const cat = await classifyMessage(header);
          const fresh = await messenger.messages.get(cmsg.id);
          const raw = headerToRawMessage(fresh, "inbox", cat);
          await applyMessageDetails(raw, cmsg);
          await db.messages.put(raw);
          updated.push(raw);
        } catch (e) {
          log.warn("override", "reclassify failed", { id: cmsg.id, e });
        }
      }
      if (updated.length) broadcast({ type: "delta", updated });
      return;
    }
    case "set-bundle-rule": {
      await db.bundleRules.put(msg.rule);
      void reclassifyAll().catch((e) =>
        log.warn("reclassify", "after set-bundle-rule failed", e),
      );
      return;
    }
    case "delete-bundle-rule": {
      await db.bundleRules.delete(msg.id);
      void reclassifyAll().catch((e) =>
        log.warn("reclassify", "after delete-bundle-rule failed", e),
      );
      return;
    }
    case "set-custom-bundle": {
      await db.customBundles.put(msg.bundle);
      void reclassifyAll().catch((e) =>
        log.warn("reclassify", "after set-custom-bundle failed", e),
      );
      return;
    }
    case "delete-custom-bundle": {
      await db.customBundles.delete(msg.id);
      const affected = (await db.messages.toArray()).filter(
        (m) => m.origin === "inbox" && m.category === msg.id,
      );
      const updated = [];
      for (const cachedMsg of affected) {
        try {
          const header = await messenger.messages.get(cachedMsg.id);
          const cat = await classifyMessage(header);
          const fresh = await messenger.messages.get(cachedMsg.id);
          const raw = headerToRawMessage(fresh, "inbox", cat);
          await applyMessageDetails(raw, cachedMsg);
          await db.messages.put(raw);
          updated.push(raw);
        } catch (e) {
          log.warn("delete-custom-bundle", "reclassify failed", { id: cachedMsg.id, e });
        }
      }
      if (updated.length) broadcast({ type: "delta", updated });
      return;
    }
  }
});

log.info("background", "ready");

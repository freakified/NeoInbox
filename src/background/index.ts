import { ensureTagsRegistered } from "./tags";
import {
  classifyAndTag,
  doneMessage,
  pinMessage,
  trashMessage,
} from "./ingest";
import { headerToRawMessage } from "./messageMap";
import { handleSnoozeAlarm, snoozeMessage } from "./snooze";
import { runBackfill, reclassifyAll } from "./backfill";
import { pushMyEmails, wireSyncEngine } from "./sync";
import { broadcast, onCommand, startPortServer } from "./port";
import { setOverride } from "../classifier/overrides";
import { db } from "../store/db";
import { categoryFromTags } from "../shared/categories";

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

messenger.browserAction.onClicked.addListener(() => {
  void openOrFocusInbox();
});

void ensureTagsRegistered()
  .then(() => console.info("[NeoInbox] tags registered"))
  .catch((e) => console.warn("[NeoInbox] tag registration failed", e));

messenger.runtime.onInstalled.addListener(async (details) => {
  console.info("[NeoInbox] onInstalled", details.reason);
  await ensureTagsRegistered();
  void runBackfill().catch((e) => console.warn("[NeoInbox] backfill failed", e));
});

messenger.runtime.onStartup.addListener(() => {
  void ensureTagsRegistered().catch(() => {});
  void runBackfill().catch((e) => console.warn("[NeoInbox] backfill failed", e));
});

messenger.alarms.onAlarm.addListener(async (alarm) => {
  const result = await handleSnoozeAlarm(alarm.name);
  if (!result) return;
  if (result.restoredHeader) {
    const raw = headerToRawMessage(result.restoredHeader, "inbox");
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
    case "hello":
      await pushMyEmails();
      return;
    case "pin": {
      await pinMessage(msg.messageId, msg.pinned);
      const header = await messenger.messages.get(msg.messageId);
      const cached = await db.messages.get(msg.messageId);
      const raw = headerToRawMessage(header, cached?.origin ?? "inbox");
      await db.messages.put(raw);
      broadcast({ type: "delta", updated: [raw] });
      return;
    }
    case "done": {
      await doneMessage(msg.messageId);
      await db.messages.delete(msg.messageId);
      broadcast({ type: "delta", removedIds: [msg.messageId] });
      return;
    }
    case "trash": {
      await trashMessage(msg.messageId);
      await db.messages.delete(msg.messageId);
      broadcast({ type: "delta", removedIds: [msg.messageId] });
      return;
    }
    case "snooze": {
      const { removedId } = await snoozeMessage(msg.messageId, msg.wakeAt);
      await db.messages.delete(removedId);
      broadcast({ type: "delta", removedIds: [removedId] });
      return;
    }
    case "reclassify": {
      void reclassifyAll().catch((e) =>
        console.warn("[NeoInbox] reclassify failed", e),
      );
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
          const stripped: messenger.messages.MessageHeader = {
            ...header,
            tags: (header.tags ?? []).filter(
              (t) => categoryFromTags([t]) === null,
            ),
          };
          const cat = await classifyAndTag(stripped);
          const fresh = await messenger.messages.get(cmsg.id);
          const raw = headerToRawMessage(fresh, "inbox", cat);
          await db.messages.put(raw);
          updated.push(raw);
        } catch (e) {
          console.warn("[NeoInbox] override retag failed", cmsg.id, e);
        }
      }
      if (updated.length) broadcast({ type: "delta", updated });
      return;
    }
    case "set-custom-bundle": {
      await db.customBundles.put(msg.bundle);
      void reclassifyAll().catch((e) =>
        console.warn("[NeoInbox] reclassify after set-custom-bundle failed", e),
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
          const stripped: messenger.messages.MessageHeader = {
            ...header,
            tags: (header.tags ?? []).filter((t) => categoryFromTags([t]) === null),
          };
          const cat = await classifyAndTag(stripped);
          const fresh = await messenger.messages.get(cachedMsg.id);
          const raw = headerToRawMessage(fresh, "inbox", cat);
          await db.messages.put(raw);
          updated.push(raw);
        } catch (e) {
          console.warn("[NeoInbox] delete-custom-bundle retag failed", cachedMsg.id, e);
        }
      }
      if (updated.length) broadcast({ type: "delta", updated });
      return;
    }
  }
});

console.info("[NeoInbox] background ready");

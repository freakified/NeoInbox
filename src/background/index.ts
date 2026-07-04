import {
  applyMessageDetails,
  classifyMessage,
  doneMessage,
  pinMessage,
  trashMessage,
} from "./ingest";
import { headerToRawMessage } from "./messageMap";
import {
  handleSnoozeAlarm,
  snoozeAlarmName,
  snoozeMessage,
  wakeSnoozedMessage,
} from "./snooze";
import {
  getLastProgress,
  runBackfill,
  runIncrementalSync,
  runStartupSync,
} from "./backfill";
import { pushMyEmails, wireSyncEngine } from "./sync";
import { broadcast, onCommand, startPortServer } from "./port";
import { invalidateRouteRules } from "../classifier/routeRules";
import { domainMatches } from "../classifier/features";
import { db } from "../store/db";
import { collectArchiveFolders, invalidateFolderCache } from "../shared/folders";
import { SNOOZED_KEY } from "../shared/categories";
import { parseSender } from "../shared/senders";
import { log } from "../shared/log";
import type { RouteRuleRecord } from "../shared/types";

const INBOX_URL = "inbox.html";

/**
 * Re-run the full classify pipeline for cached inbox messages that match a
 * rule's key. Adding, reassigning, or deleting a rule can only change the
 * category of messages its key matches, so this candidate set is sufficient.
 */
const reclassifyRuleMatches = async (rule: RouteRuleRecord): Promise<void> => {
  const cached = (await db.messages.toArray()).filter((m) => {
    if (m.origin !== "inbox") return false;
    if (rule.type === "subject_keyword") return m.subject.toLowerCase().includes(rule.value);
    const sender = parseSender(m.author);
    if (rule.type === "email") return sender.email === rule.value;
    return domainMatches(sender.domain, [rule.value]);
  });
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
      log.warn("route-rule", "reclassify failed", { id: cmsg.id, e });
    }
  }
  if (updated.length) broadcast({ type: "delta", updated });
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

let restoreSnoozeAlarmsPromise: Promise<void> | null = null;

const restoreSnoozeAlarms = async (): Promise<void> => {
  const now = Date.now();
  const snoozes = await db.snoozes.toArray();
  for (const snooze of snoozes) {
    if (snooze.wakeAt <= now) {
      await wakeSnoozedMessage(snooze.messageId, "alarm");
    } else {
      await messenger.alarms.create(snoozeAlarmName(snooze.messageId), {
        when: snooze.wakeAt,
      });
    }
  }
}

const ensureSnoozeAlarmsRestored = (): Promise<void> => {
  restoreSnoozeAlarmsPromise ??= restoreSnoozeAlarms().finally(() => {
    restoreSnoozeAlarmsPromise = null;
  });
  return restoreSnoozeAlarmsPromise;
}

messenger.browserAction.onClicked.addListener(() => {
  void openOrFocusInbox();
});

messenger.runtime.onInstalled.addListener((details) => {
  log.info("background", "onInstalled", details.reason);
  void ensureSnoozeAlarmsRestored().catch((e) => log.warn("snooze", "restore alarms failed", e));
  void runBackfill().catch((e) => log.warn("backfill", "failed", e));
});

messenger.runtime.onStartup.addListener(() => {
  void ensureSnoozeAlarmsRestored().catch((e) => log.warn("snooze", "restore alarms failed", e));
  void runStartupSync().catch((e) => log.warn("backfill", "startup sync failed", e));
});

const SYNC_ALARM = "neoinbox-periodic-sync";
messenger.alarms.create(SYNC_ALARM, { periodInMinutes: 15, delayInMinutes: 15 });

messenger.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SYNC_ALARM) {
    try {
      await runIncrementalSync();
    } catch (e) {
      log.warn("backfill", "periodic sync failed", e);
    }
    return;
  }
  await handleSnoozeAlarm(alarm.name);
});

for (const event of [
  messenger.folders.onCreated,
  messenger.folders.onRenamed,
  messenger.folders.onMoved,
  messenger.folders.onDeleted,
  messenger.folders.onUpdated,
]) {
  (event as { addListener?: (cb: () => void) => void } | undefined)?.addListener?.(
    invalidateFolderCache,
  );
}

wireSyncEngine();
startPortServer();
void ensureSnoozeAlarmsRestored().catch((e) => log.warn("snooze", "restore alarms failed", e));

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
    case "unsnooze": {
      try {
        await wakeSnoozedMessage(msg.messageId, "unsnooze");
      } catch (e) {
        log.warn("command", "unsnooze failed", { id: msg.messageId, e: String(e) });
        broadcast({
          type: "command-failed",
          command: "unsnooze",
          messageId: msg.messageId,
          reason: String((e as Error)?.message ?? e),
        });
      }
      return;
    }
    case "set-route-rule": {
      // One destination per (type, value) key: reassign rather than duplicate.
      const existing = await db.routeRules
        .where("[type+value]")
        .equals([msg.rule.type, msg.rule.value])
        .first();
      if (existing && existing.id !== msg.rule.id) await db.routeRules.delete(existing.id);
      await db.routeRules.put(msg.rule);
      invalidateRouteRules();
      void reclassifyRuleMatches(msg.rule).catch((e) =>
        log.warn("reclassify", "after set-route-rule failed", e),
      );
      return;
    }
    case "delete-route-rule": {
      const rule = await db.routeRules.get(msg.id);
      if (!rule) return;
      await db.routeRules.delete(msg.id);
      invalidateRouteRules();
      void reclassifyRuleMatches(rule).catch((e) =>
        log.warn("reclassify", "after delete-route-rule failed", e),
      );
      return;
    }
    case "set-custom-bundle": {
      // Bundle records are display metadata only; rules arrive separately.
      await db.customBundles.put(msg.bundle);
      return;
    }
    case "delete-custom-bundle": {
      await db.customBundles.delete(msg.id);
      await db.routeRules.where("target").equals(msg.id).delete();
      invalidateRouteRules();
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

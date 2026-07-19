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
  serialized,
} from "./backfill";
import { scanActive } from "./scanGuard";
import { pushMyEmails, wireSyncEngine } from "./sync";
import { cleanupLegacyTags } from "./legacyTags";
import { applyLocalState } from "./localState";
import { broadcast, onCommand, startPortServer } from "./port";
import { invalidateRouteRules } from "../classifier/routeRules";
import { db } from "../store/db";
import { collectArchiveFolders, invalidateFolderCache } from "../shared/folders";
import { ruleMatchesMessage } from "../shared/routeRules";
import { log } from "../shared/log";
import type { RawMessage, RouteRuleRecord } from "../shared/types";

const INBOX_URL = "inbox.html";

/**
 * Re-run the full classify pipeline for these cached inbox messages, persist
 * the results, and broadcast one delta. Returns how many changed category.
 */
const reclassifyMessages = async (cached: RawMessage[]): Promise<{ scanned: number; moved: number }> => {
  const updated = [];
  let moved = 0;
  for (const cmsg of cached) {
    try {
      const header = await messenger.messages.get(cmsg.id);
      const { category, incomplete } = await classifyMessage(header);
      const fresh = await messenger.messages.get(cmsg.id);
      const raw = headerToRawMessage(fresh, "inbox", category);
      raw.classifiedIncomplete = incomplete;
      await applyLocalState(raw);
      await applyMessageDetails(raw, cmsg);
      await db.messages.put(raw);
      updated.push(raw);
      if ((raw.category ?? null) !== (cmsg.category ?? null)) moved++;
    } catch (e) {
      log.warn("reclassify", "failed", { id: cmsg.id, e });
    }
  }
  if (updated.length) broadcast({ type: "delta", updated });
  return { scanned: cached.length, moved };
}

const RULE_SWEEP_SETTLE_MS = 2_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reclassify cached inbox messages that match a rule's key. Adding,
 * reassigning, or deleting a rule can only change the category of messages
 * its key matches, so this candidate set is sufficient.
 */
const reclassifyRuleMatches = async (rule: RouteRuleRecord): Promise<void> => {
  const sweep = async (): Promise<void> => {
    const cached = (await db.messages.toArray()).filter((m) => ruleMatchesMessage(rule, m));
    await reclassifyMessages(cached);
  };
  await sweep();
  // A scan in flight may still hold matching rows in an unflushed batch that
  // was classified before the rule landed; those rows would be written after
  // the sweep above with pre-rule categories. Sweep again once the scan
  // chain drains.
  if (scanActive()) await serialized(sweep);
  // The live new-mail path can likewise be mid-classification when the rule
  // lands and write its row after the sweeps above; one settled pass catches
  // those stragglers.
  await sleep(RULE_SWEEP_SETTLE_MS);
  await sweep();
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
void cleanupLegacyTags().catch((e) => log.warn("legacy-tags", "cleanup failed", e));
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
      try {
        await pinMessage(msg.messageId, msg.pinned);
      } catch (e) {
        // Fall through to the echo below: it rebroadcasts the message's real
        // state, which reverts the UI's optimistic pin instead of stranding it.
        log.warn("command", "pin failed", { id: msg.messageId, e: String(e) });
      }
      const header = await messenger.messages.get(msg.messageId);
      const cached = await db.messages.get(msg.messageId);
      const raw = headerToRawMessage(
        header,
        cached?.origin ?? "inbox",
        cached?.category ?? null,
      );
      await applyLocalState(raw);
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
          await applyLocalState(raw);
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
          snoozed: true,
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
      await reclassifyMessages(affected);
      return;
    }
    case "reclassify": {
      invalidateRouteRules();
      const wanted = msg.messageIds ? new Set(msg.messageIds) : null;
      const cached = (await db.messages.toArray()).filter(
        (m) => m.origin === "inbox" && (!wanted || wanted.has(m.id)),
      );
      const result = await reclassifyMessages(cached);
      broadcast({ type: "reclassify-done", ...result });
      return;
    }
  }
});

log.info("background", "ready");

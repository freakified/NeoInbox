import { handleSnoozeAlarm, snoozeAlarmName, wakeSnoozedMessage } from "./snooze";
import {
  retryIncompleteClassifications,
  runBackfill,
  runIncrementalSync,
  runStartupSync,
  startClassifierVersionSweep,
} from "./backfill";
import { handleCommand } from "./commands";
import { wireSyncEngine } from "./sync";
import { cleanupLegacyTags } from "./legacyTags";
import { onCommand, startPortServer } from "./port";
import { installTripExtract, scheduleTripExtraction } from "./extract";
import { installTripScan } from "./tripScan";
import { installClassifyDump } from "./classifyDebug";
import { installSampleDump } from "./sampleDump";
import { db } from "../store/db";
import { invalidateFolderCache } from "../shared/folders";
import { log } from "../shared/log";

const INBOX_URL = "inbox.html";

const openOrFocusInbox = async (): Promise<void> => {
  const tabs = await messenger.tabs.query({});
  const existing = tabs.find((t) => t.url?.endsWith(`/${INBOX_URL}`));
  if (existing?.id !== undefined) {
    await messenger.tabs.update(existing.id, { active: true });
    return;
  }
  await messenger.tabs.create({ url: INBOX_URL });
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
  void runBackfill()
    .then(scheduleTripExtraction)
    .catch((e) => log.warn("backfill", "failed", e));
});

messenger.runtime.onStartup.addListener(() => {
  void ensureSnoozeAlarmsRestored().catch((e) => log.warn("snooze", "restore alarms failed", e));
  void runStartupSync()
    .then(scheduleTripExtraction)
    .catch((e) => log.warn("backfill", "startup sync failed", e));
});

const SYNC_ALARM = "neoinbox-periodic-sync";
messenger.alarms.create(SYNC_ALARM, { periodInMinutes: 15, delayInMinutes: 15 });

/**
 * Mail classified before its body was available (getFull() fails while IMAP is
 * still syncing — the norm for a backlog that arrived while Thunderbird was
 * closed) lands with no category. Repair used to ride along in runScan's
 * finally, which meant no scan, no repair; it gets its own alarm so it runs
 * regardless of what the scan chain is doing, and soon after startup, when the
 * backlog is freshest.
 */
const CLASSIFY_RETRY_ALARM = "neoinbox-classify-retry";
messenger.alarms.create(CLASSIFY_RETRY_ALARM, { periodInMinutes: 10, delayInMinutes: 2 });

messenger.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SYNC_ALARM) {
    try {
      await runIncrementalSync();
      scheduleTripExtraction();
    } catch (e) {
      log.warn("backfill", "periodic sync failed", e);
    }
    return;
  }
  if (alarm.name === CLASSIFY_RETRY_ALARM) {
    try {
      await retryIncompleteClassifications();
    } catch (e) {
      log.warn("backfill", "classification retry failed", e);
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
installTripScan();
installTripExtract();
installClassifyDump();
installSampleDump();
void cleanupLegacyTags().catch((e) => log.warn("legacy-tags", "cleanup failed", e));
// Carries a classifier rules change to mail that is already cached. Runs in
// chunks behind whatever scan onInstalled/onStartup kicked off, and no-ops
// entirely when the stored version already matches.
startClassifierVersionSweep();
void ensureSnoozeAlarmsRestored().catch((e) => log.warn("snooze", "restore alarms failed", e));

onCommand(handleCommand);

log.info("background", "ready");

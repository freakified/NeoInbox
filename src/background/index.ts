import { handleSnoozeAlarm, snoozeAlarmName, wakeSnoozedMessage } from "./snooze";
import { runBackfill, runIncrementalSync, runStartupSync } from "./backfill";
import { retryIncompleteClassifications, startClassifierVersionSweep } from "./classifierSweep";
import { handleCommand } from "./commands";
import { wireSyncEngine } from "./sync";
import { onCommand, startPortServer } from "./port";
import { installTripExtract, scheduleTripExtraction } from "./extract";
import { installTripScan } from "./tripScan";
import { resumeArchiveJob } from "./archiveJob";
import { installClassifyDump } from "./classifyDebug";
import { installSampleDump } from "./sampleDump";
import { db } from "../store/db";
import { invalidateFolderCache } from "../shared/folders";
import { log } from "../shared/log";
import { getOpenMode, getOpenOnStartup, getWindowBounds, OPEN_MODE_KEY } from "../shared/openMode";

const INBOX_URL = "inbox.html";

const isInboxTab = (tab: messenger.tabs.Tab): boolean => !!tab.url?.endsWith(`/${INBOX_URL}`);

const focusWindow = async (win: messenger.windows.Window): Promise<void> => {
  if (win.id === undefined) return;
  await messenger.windows.update(win.id, {
    focused: true,
    ...(win.state === "minimized" ? { state: "normal" as const } : {}),
  });
}

/**
 * Tab mode: NeoInbox lives in a main window. Any NeoInbox popup left over
 * from window mode is closed, mirroring openInboxWindow.
 */
const openInboxTab = async (): Promise<void> => {
  const windows = await messenger.windows.getAll({ populate: true });
  const normal = windows.filter((w) => w.type === "normal");
  const existingWindow = normal.find((w) => w.tabs?.some(isInboxTab));
  const existing = existingWindow?.tabs?.find(isInboxTab);

  if (existingWindow && existing?.id !== undefined) {
    await messenger.tabs.update(existing.id, { active: true });
    await focusWindow(existingWindow);
    return;
  }
  // Window mode lets the user close the main window, so there may be none.
  const mainWindow = normal.find((w) => w.focused) ?? normal[0];
  if (mainWindow?.id !== undefined) {
    await messenger.tabs.create({ url: INBOX_URL, windowId: mainWindow.id });
    await focusWindow(mainWindow);
  } else {
    await messenger.windows.create({ type: "normal", url: INBOX_URL });
  }
  for (const popup of windows.filter((w) => w.type === "popup" && w.tabs?.some(isInboxTab))) {
    if (popup.id !== undefined) await messenger.windows.remove(popup.id).catch(() => undefined);
  }
}

/**
 * Window mode: NeoInbox gets a popup window of its own, so it reads as a
 * standalone app. The main window is left alone; the user can close it and
 * NeoInbox keeps running. Any NeoInbox tab left in a main window is closed so
 * there's only ever one copy on screen.
 */
const openInboxWindow = async (): Promise<void> => {
  const windows = await messenger.windows.getAll({ populate: true });
  const popup = windows.find((w) => w.type === "popup" && w.tabs?.some(isInboxTab));

  if (popup) {
    await focusWindow(popup);
  } else {
    const bounds = await getWindowBounds();
    await messenger.windows.create({
      type: "popup",
      url: INBOX_URL,
      ...(bounds ?? { width: 1200, height: 860 }),
    });
    for (const tab of windows.filter((w) => w.type === "normal").flatMap((w) => w.tabs ?? [])) {
      if (isInboxTab(tab) && tab.id !== undefined) {
        await messenger.tabs.remove(tab.id).catch(() => undefined);
      }
    }
  }
}

const openOrFocusInbox = async (): Promise<void> => {
  if ((await getOpenMode()) === "window") await openInboxWindow();
  else await openInboxTab();
}

let restoreSnoozeAlarmsPromise: Promise<void> | null = null;

const restoreSnoozeAlarms = async (): Promise<void> => {
  const now = Date.now();
  const snoozes = await db.snoozes.toArray();
  for (const snooze of snoozes) {
    if (snooze.wakeAt <= now) {
      await wakeSnoozedMessage(snooze.messageKey, "alarm");
    } else {
      await messenger.alarms.create(snoozeAlarmName(snooze.messageKey), {
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

// Changing tab/window in Settings moves an open NeoInbox over right away
// (the Settings page itself is what gets closed and reopened).
messenger.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(OPEN_MODE_KEY in changes)) return;
  void (async () => {
    const windows = await messenger.windows.getAll({ populate: true });
    if (windows.some((w) => w.tabs?.some(isInboxTab))) await openOrFocusInbox();
  })().catch((e) => log.warn("background", "reopening inbox failed", e));
});

messenger.runtime.onInstalled.addListener((details) => {
  log.info("background", "onInstalled", details.reason);
  // A first-timer shouldn't have to find the toolbar button.
  if (details.reason === "install") {
    void openOrFocusInbox().catch((e) => log.warn("background", "opening inbox failed", e));
  }
  void ensureSnoozeAlarmsRestored().catch((e) => log.warn("snooze", "restore alarms failed", e));
  void runBackfill()
    .then(scheduleTripExtraction)
    .then(resumeArchiveJob)
    .catch((e) => log.warn("backfill", "failed", e));
});

messenger.runtime.onStartup.addListener(() => {
  void getOpenOnStartup()
    .then((open) => (open ? openOrFocusInbox() : undefined))
    .catch((e) => log.warn("background", "opening inbox failed", e));
  void ensureSnoozeAlarmsRestored().catch((e) => log.warn("snooze", "restore alarms failed", e));
  void runStartupSync()
    .then(scheduleTripExtraction)
    .then(resumeArchiveJob)
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
// Posts real mail to a local receiver for `pnpm eval`; never in a release.
if (import.meta.env.MODE === "development") installSampleDump();
// Carries a classifier rules change to mail that is already cached. Runs in
// chunks behind whatever scan onInstalled/onStartup kicked off, and no-ops
// entirely when the stored version already matches.
startClassifierVersionSweep();
void ensureSnoozeAlarmsRestored().catch((e) => log.warn("snooze", "restore alarms failed", e));

onCommand(handleCommand);

log.info("background", "ready");

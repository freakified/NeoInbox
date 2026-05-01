import { db } from "../store/db";
import { SNOOZED_KEY } from "../shared/categories";
import { log } from "../shared/log";
import type { SnoozeRecord } from "../shared/types";
import { archiveFolderIdsForAccount } from "./archiveFolders";
import { doneMessage } from "./ingest";

const ALARM_PREFIX = "neoinbox-snooze-";
const SEARCH_PAGE_LIMIT = 20;

interface SnoozeRecordWithHeader extends SnoozeRecord {
  headerMessageId: string;
}

type FolderRef = { id?: string; accountId?: string };
type HeaderWithFolder = messenger.messages.MessageHeader & {
  folder?: FolderRef;
  headerMessageId?: string;
};

export const snoozeMessage = async (
  messageId: number,
  wakeAt: number,
): Promise<{ removedId: number }> => {
  const msg = (await messenger.messages.get(messageId)) as HeaderWithFolder;
  const originFolderId = msg.folder?.id ?? "";
  const originAccountId = msg.folder?.accountId ?? "";
  const headerMessageId = msg.headerMessageId ?? "";

  const record: SnoozeRecordWithHeader = {
    messageId,
    wakeAt,
    originFolderId,
    originAccountId,
    headerMessageId,
  };
  await db.snoozes.put(record);

  const nextTags = [
    ...(msg.tags ?? []).filter((t) => t !== SNOOZED_KEY),
    SNOOZED_KEY,
  ];
  await messenger.messages.update(messageId, { tags: nextTags });

  try {
    await doneMessage(messageId);
  } catch (e) {
    log.warn("snooze", "archive failed; rolling back snooze record + tag", {
      messageId,
      e: String(e),
    });
    try {
      await messenger.messages.update(messageId, {
        tags: (msg.tags ?? []).filter((t) => t !== SNOOZED_KEY),
      });
    } catch (untagErr) {
      log.warn("snooze", "rollback untag failed", { messageId, untagErr });
    }
    await db.snoozes.delete(messageId);
    throw e;
  }

  await messenger.alarms.create(`${ALARM_PREFIX}${messageId}`, { when: wakeAt });

  return { removedId: messageId };
}

export interface SnoozeWakeResult {
  originalId: number;
  restoredHeader?: messenger.messages.MessageHeader;
}

export const handleSnoozeAlarm = async (
  alarmName: string,
): Promise<SnoozeWakeResult | null> => {
  if (!alarmName.startsWith(ALARM_PREFIX)) return null;
  const originalId = parseInt(alarmName.slice(ALARM_PREFIX.length), 10);
  if (isNaN(originalId)) return null;

  const record = (await db.snoozes.get(originalId)) as
    | SnoozeRecordWithHeader
    | undefined;
  if (!record) return { originalId };

  const restored = await findByHeaderMessageId(
    record.headerMessageId,
    record.originAccountId,
  );

  if (restored) {
    try {
      await messenger.messages.update(restored.id, {
        tags: (restored.tags ?? []).filter((t) => t !== SNOOZED_KEY),
      });
    } catch (e) {
      log.warn("snooze", "untag on wake failed", e);
    }
    if (record.originFolderId) {
      try {
        await messenger.messages.move(
          [restored.id],
          record.originFolderId as unknown as messenger.folders.MailFolderId,
        );
      } catch (e) {
        log.warn("snooze", "move-back on wake failed", e);
      }
    }
  }

  await db.snoozes.delete(originalId);
  return { originalId, restoredHeader: restored };
}

const findByHeaderMessageId = async (
  headerMessageId: string,
  accountId: string,
): Promise<messenger.messages.MessageHeader | undefined> => {
  if (!headerMessageId) return undefined;
  const folders = await archiveFolderIdsForAccount(accountId);
  for (const folderId of folders) {
    const found = await scanFolderForHeader(folderId, headerMessageId);
    if (found) return found;
  }
  return undefined;
}

const scanFolderForHeader = async (
  folderId: string,
  headerMessageId: string,
): Promise<messenger.messages.MessageHeader | undefined> => {
  let pages = 0;
  let page = await messenger.messages.list(
    folderId as unknown as messenger.folders.MailFolderId,
  );
  while (true) {
    for (const m of page.messages) {
      const h = (m as HeaderWithFolder).headerMessageId;
      if (h && h === headerMessageId) return m;
    }
    if (!page.id || ++pages >= SEARCH_PAGE_LIMIT) return undefined;
    page = await messenger.messages.continueList(page.id);
  }
}

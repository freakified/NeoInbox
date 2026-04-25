import { db } from "../store/db";
import { SNOOZED_KEY } from "../shared/categories";
import type { SnoozeRecord } from "../shared/types";

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
    await messenger.messages.archive([messageId]);
  } catch (e) {
    console.warn("[NeoInbox] snooze archive failed", e);
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
      console.warn("[NeoInbox] untag on wake failed", e);
    }
    if (record.originFolderId) {
      try {
        await messenger.messages.move(
          [restored.id],
          record.originFolderId as unknown as messenger.folders.MailFolderId,
        );
      } catch (e) {
        console.warn("[NeoInbox] move-back on wake failed", e);
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

const archiveFolderIdsForAccount = async (
  accountId: string,
): Promise<string[]> => {
  const accounts = await messenger.accounts.list();
  const out: string[] = [];
  for (const acc of accounts) {
    if (accountId && acc.id !== accountId) continue;
    walk(acc.folders ?? [], (f) => {
      if (!f.id) return;
      if (
        f.specialUse?.includes("archives") ||
        (f as unknown as { type?: string }).type === "archives"
      ) {
        out.push(f.id);
      }
    });
  }
  return out;
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

const walk = (
  folders: messenger.folders.MailFolder[],
  visit: (f: messenger.folders.MailFolder) => void,
): void => {
  for (const f of folders) {
    visit(f);
    if (f.subFolders) walk(f.subFolders, visit);
  }
};

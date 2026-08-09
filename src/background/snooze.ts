import { db } from "../store/db";
import { log } from "../shared/log";
import type { RawMessage, SnoozeRecord } from "../shared/types";
import { archiveFolderIdsForAccount } from "./archiveFolders";
import {
  applyMessageDetails,
  classifyMessage,
  doneMessage,
  loadMessageBody,
} from "./ingest";
import { applyClassification } from "../classifier/version";
import { applyLocalState, invalidateSnoozeIndex } from "./localState";
import { headerToRawMessage } from "./messageMap";
import { broadcast } from "./port";

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

type MessageListLike = { messages?: messenger.messages.MessageHeader[] };

export const snoozeAlarmName = (messageId: number): string =>
  `${ALARM_PREFIX}${messageId}`;

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
  invalidateSnoozeIndex();

  try {
    await doneMessage(messageId);
  } catch (e) {
    log.warn("snooze", "archive failed; rolling back snooze record", {
      messageId,
      e: String(e),
    });
    await db.snoozes.delete(messageId);
    invalidateSnoozeIndex();
    throw e;
  }

  await messenger.alarms.create(snoozeAlarmName(messageId), { when: wakeAt });

  return { removedId: messageId };
}

export type WakeReason = "alarm" | "unsnooze" | "reply";

const inFlightWakes = new Set<number>();

/**
 * Bring a snoozed message back to the inbox: untag, move to its origin
 * folder, refresh the cache, and notify the UI. `reason` controls where the
 * thread lands in the stream: an alarm wake resurfaces it at its wake time,
 * a manual unsnooze resurfaces it now, and a reply wake keeps natural date
 * order because the new reply already carries the thread.
 */
export const wakeSnoozedMessage = async (
  originalId: number,
  reason: WakeReason,
): Promise<void> => {
  if (inFlightWakes.has(originalId)) return;
  inFlightWakes.add(originalId);
  try {
    await messenger.alarms.clear(snoozeAlarmName(originalId));
    const record = (await db.snoozes.get(originalId)) as
      | SnoozeRecordWithHeader
      | undefined;
    if (!record) return;

    const restored = await findByHeaderMessageId(
      record.headerMessageId,
      record.originAccountId,
    );
    let restoredHeader = restored;

    if (restored) {
      if (record.originFolderId) {
        try {
          const moved = await messenger.messages.move(
            [restored.id],
            record.originFolderId as unknown as messenger.folders.MailFolderId,
          ) as MessageListLike | undefined;
          restoredHeader = moved?.messages?.[0] ?? await findByHeaderMessageIdInFolder(
            record.originFolderId,
            record.headerMessageId,
          ) ?? restored;
        } catch (e) {
          log.warn("snooze", "move-back on wake failed", e);
        }
      }
    }

    await db.snoozes.delete(originalId);
    invalidateSnoozeIndex();

    if (!restoredHeader) {
      await db.messages.delete(originalId);
      broadcast({ type: "delta", removedIds: [originalId] });
      return;
    }

    const raw = headerToRawMessage(restoredHeader, "inbox");
    const body = await loadMessageBody(restoredHeader.id);
    applyClassification(raw, await classifyMessage(restoredHeader, body));
    await applyLocalState(raw);
    if (reason === "alarm") raw.resurfacedAt = record.wakeAt;
    else if (reason === "unsnooze") raw.resurfacedAt = Date.now();
    await applyMessageDetails(raw, undefined, body);
    if (originalId !== raw.id) {
      await db.messages.delete(originalId);
      broadcast({ type: "delta", removedIds: [originalId] });
    }
    await removeCachedSnoozedCopies(raw);
    await db.messages.put(raw);
    broadcast({ type: "delta", added: [raw] });
  } finally {
    inFlightWakes.delete(originalId);
  }
}

export const handleSnoozeAlarm = async (alarmName: string): Promise<void> => {
  if (!alarmName.startsWith(ALARM_PREFIX)) return;
  const originalId = parseInt(alarmName.slice(ALARM_PREFIX.length), 10);
  if (isNaN(originalId)) return;
  await wakeSnoozedMessage(originalId, "alarm");
}

const normalizeMid = (id: string | undefined): string =>
  (id ?? "").replace(/[<>]/g, "").trim().toLowerCase();

const messageIdChain = (m: RawMessage): string[] =>
  [m.headerMessageId, ...(m.references ?? []), ...(m.inReplyTo ?? [])]
    .map(normalizeMid)
    .filter(Boolean);

/**
 * Gmail-style early wake: a new message arriving in a snoozed conversation
 * cancels the snooze and returns the thread to the inbox immediately.
 */
export const wakeSnoozesForNewMail = async (
  added: readonly RawMessage[],
): Promise<void> => {
  const records = (await db.snoozes.toArray()) as SnoozeRecordWithHeader[];
  if (!records.length) return;

  const newIdsByAccount = new Map<string, Set<string>>();
  for (const m of added) {
    if (m.origin !== "inbox") continue;
    const set = newIdsByAccount.get(m.accountId) ?? new Set<string>();
    for (const id of messageIdChain(m)) set.add(id);
    newIdsByAccount.set(m.accountId, set);
  }
  if (!newIdsByAccount.size) return;

  for (const record of records) {
    const newIds = newIdsByAccount.get(record.originAccountId);
    if (!newIds) continue;
    const cached = await db.messages.get(record.messageId);
    const recordIds = cached
      ? messageIdChain(cached)
      : [normalizeMid(record.headerMessageId)];
    if (!recordIds.some((id) => id && newIds.has(id))) continue;
    try {
      await wakeSnoozedMessage(record.messageId, "reply");
    } catch (e) {
      log.warn("snooze", "wake on reply failed", {
        messageId: record.messageId,
        e: String(e),
      });
    }
  }
}

const removeCachedSnoozedCopies = async (
  raw: { id: number; headerMessageId: string },
): Promise<void> => {
  if (!raw.headerMessageId) return;
  const staleIds = (await db.messages.toArray())
    .filter((m) =>
      m.id !== raw.id &&
      m.headerMessageId === raw.headerMessageId &&
      m.snoozed
    )
    .map((m) => m.id);
  if (!staleIds.length) return;
  await db.messages.bulkDelete(staleIds);
  broadcast({ type: "delta", removedIds: staleIds });
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

const findByHeaderMessageIdInFolder = async (
  folderId: string,
  headerMessageId: string,
): Promise<messenger.messages.MessageHeader | undefined> => {
  if (!folderId || !headerMessageId) return undefined;
  return scanFolderForHeader(folderId, headerMessageId);
}

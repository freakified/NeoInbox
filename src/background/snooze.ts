import { db } from "../store/db";
import { log } from "../shared/log";
import type { RawMessage, SnoozeRecord } from "../shared/types";
import {
  archiveFolderIdsForAccount,
  findByHeaderMessageIdInFolder,
} from "./archiveFolders";
import {
  applyMessageDetails,
  classifyMessage,
  doneMessage,
  loadMessageBody,
} from "./ingest";
import { applyClassification } from "../classifier/version";
import { pinKeyOf } from "../shared/pinKey";
import {
  applyLocalState,
  clearResurfaced,
  invalidateSnoozeIndex,
  setResurfaced,
} from "./localState";
import { headerToRawMessage } from "./messageMap";
import { broadcast } from "./port";

const ALARM_PREFIX = "neoinbox-snooze-";

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
  await clearResurfaced(pinKeyOf({ headerMessageId, id: messageId }));

  try {
    const archived = await doneMessage(messageId);
    if (archived) {
      record.archivedId = archived.id;
      record.archivedFolderId = archived.folderId;
      await db.snoozes.put(record);
      invalidateSnoozeIndex();
    }
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

    const restored = await findSnoozedMessage(record);
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
    if (reason === "alarm") await setResurfaced(pinKeyOf(raw), record.wakeAt, true);
    else if (reason === "unsnooze") await setResurfaced(pinKeyOf(raw), Date.now(), false);
    await applyLocalState(raw);
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

/**
 * Finds the snoozed message so it can be moved back.
 *
 * Snoozing records where it parked the message, so the common path is a single
 * `messages.get` on a known id, verified by Message-ID in case Thunderbird
 * remapped it. Only records written before that existed — or a snooze whose
 * destination couldn't be pinned down — fall back to searching, and even then
 * it's a folder-scoped query per archive folder, never an enumeration.
 */
const findSnoozedMessage = async (
  record: SnoozeRecordWithHeader,
): Promise<messenger.messages.MessageHeader | undefined> => {
  const { headerMessageId } = record;
  if (!headerMessageId) return undefined;

  if (record.archivedId !== undefined) {
    try {
      const header = await messenger.messages.get(record.archivedId);
      if (header.headerMessageId === headerMessageId) return header;
      log.debug("snooze", "recorded archive id points elsewhere; searching", {
        messageId: record.messageId,
        archivedId: record.archivedId,
      });
    } catch {
      /* id no longer resolves; fall through to the search */
    }
  }

  if (record.archivedFolderId) {
    const found = await findByHeaderMessageIdInFolder(
      record.archivedFolderId,
      headerMessageId,
    );
    if (found) return found;
  }

  for (const folderId of await archiveFolderIdsForAccount(record.originAccountId)) {
    const found = await findByHeaderMessageIdInFolder(folderId, headerMessageId);
    if (found) return found;
  }
  return undefined;
}

import { db } from "../store/db";
import { log } from "../shared/log";
import type { MessageKey } from "../shared/messageKey";
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

type MessageListLike = { messages?: messenger.messages.MessageHeader[] };

export const snoozeAlarmName = (messageKey: MessageKey): string =>
  `${ALARM_PREFIX}${messageKey}`;

/**
 * Snoozing archives the message for real, but its inbox row stays cached
 * under its inbox key, flagged snoozed, so Snoozed can list it and the wake
 * knows what to put back.
 */
export const snoozeMessage = async (messageKey: MessageKey, wakeAt: number): Promise<void> => {
  const row = await db.messages.get(messageKey);
  if (!row) throw new Error("Snoozed message is not cached");

  const record: SnoozeRecord = {
    messageKey,
    wakeAt,
    originFolderId: row.folderId,
    originAccountId: row.accountId,
    headerMessageId: row.headerMessageId,
  };
  await db.snoozes.put(record);
  invalidateSnoozeIndex();
  await clearResurfaced(pinKeyOf(row));

  try {
    const archived = await doneMessage(messageKey);
    if (archived) {
      record.archivedTbId = archived.id;
      record.archivedFolderId = archived.folderId;
      await db.snoozes.put(record);
      invalidateSnoozeIndex();
    }
  } catch (e) {
    log.warn("snooze", "archive failed; rolling back snooze record", {
      messageKey,
      e: String(e),
    });
    await db.snoozes.delete(messageKey);
    invalidateSnoozeIndex();
    throw e;
  }

  await messenger.alarms.create(snoozeAlarmName(messageKey), { when: wakeAt });
}

export type WakeReason = "alarm" | "unsnooze" | "reply";

const inFlightWakes = new Set<MessageKey>();

/**
 * Bring a snoozed message back to the inbox: untag, move to its origin
 * folder, refresh the cache, and notify the UI. `reason` controls where the
 * thread lands in the stream: an alarm wake resurfaces it at its wake time,
 * a manual unsnooze resurfaces it now, and a reply wake keeps natural date
 * order because the new reply already carries the thread.
 */
export const wakeSnoozedMessage = async (
  messageKey: MessageKey,
  reason: WakeReason,
): Promise<void> => {
  if (inFlightWakes.has(messageKey)) return;
  inFlightWakes.add(messageKey);
  try {
    await messenger.alarms.clear(snoozeAlarmName(messageKey));
    const record = await db.snoozes.get(messageKey);
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

    await db.snoozes.delete(messageKey);
    invalidateSnoozeIndex();

    if (!restoredHeader) {
      await db.messages.delete(messageKey);
      broadcast({ type: "delta", removedKeys: [messageKey] });
      return;
    }

    const raw = headerToRawMessage(restoredHeader, "inbox");
    const body = await loadMessageBody(raw.tbId);
    applyClassification(raw, await classifyMessage(restoredHeader, body));
    if (reason === "alarm") await setResurfaced(pinKeyOf(raw), record.wakeAt, true);
    else if (reason === "unsnooze") await setResurfaced(pinKeyOf(raw), Date.now(), false);
    await applyLocalState(raw);
    await applyMessageDetails(raw, undefined, body);
    // Back in its origin folder, the message normally gets its old key
    // back and the put below simply replaces the snoozed row.
    if (messageKey !== raw.key) {
      await db.messages.delete(messageKey);
      broadcast({ type: "delta", removedKeys: [messageKey] });
    }
    await removeCachedSnoozedCopies(raw);
    await db.messages.put(raw);
    broadcast({ type: "delta", added: [raw] });
  } finally {
    inFlightWakes.delete(messageKey);
  }
}

export const handleSnoozeAlarm = async (alarmName: string): Promise<void> => {
  if (!alarmName.startsWith(ALARM_PREFIX)) return;
  await wakeSnoozedMessage(alarmName.slice(ALARM_PREFIX.length), "alarm");
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
  const records = await db.snoozes.toArray();
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
    const cached = await db.messages.get(record.messageKey);
    const recordIds = cached
      ? messageIdChain(cached)
      : [normalizeMid(record.headerMessageId)];
    if (!recordIds.some((id) => id && newIds.has(id))) continue;
    try {
      await wakeSnoozedMessage(record.messageKey, "reply");
    } catch (e) {
      log.warn("snooze", "wake on reply failed", {
        messageKey: record.messageKey,
        e: String(e),
      });
    }
  }
}

const removeCachedSnoozedCopies = async (raw: RawMessage): Promise<void> => {
  if (!raw.headerMessageId) return;
  const staleKeys = (await db.messages.where("headerMessageId").equals(raw.headerMessageId).toArray())
    .filter((m) => m.key !== raw.key && m.snoozed)
    .map((m) => m.key);
  if (!staleKeys.length) return;
  await db.messages.bulkDelete(staleKeys);
  broadcast({ type: "delta", removedKeys: staleKeys });
}

/**
 * Finds the snoozed message so it can be moved back.
 *
 * Snoozing records where it parked the message, so the common path is a single
 * `messages.get` on a known id, verified by Message-ID in case Thunderbird
 * remapped it (any restart does). Otherwise it searches — the recorded folder
 * first, then each archive folder — by folder-scoped query, never enumeration.
 */
const findSnoozedMessage = async (
  record: SnoozeRecord,
): Promise<messenger.messages.MessageHeader | undefined> => {
  const { headerMessageId } = record;
  if (!headerMessageId) return undefined;

  if (record.archivedTbId !== undefined) {
    try {
      const header = await messenger.messages.get(record.archivedTbId);
      if (header.headerMessageId === headerMessageId) return header;
      log.debug("snooze", "recorded archive id points elsewhere; searching", {
        messageKey: record.messageKey,
        archivedTbId: record.archivedTbId,
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

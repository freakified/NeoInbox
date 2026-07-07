import { pinKeyOf } from "../shared/pinKey";
import { db } from "../store/db";
import type { RawMessage } from "../shared/types";

/**
 * NeoInbox-local per-message state (pin, snooze). It lives entirely in the
 * extension's IndexedDB so the real mailbox is never touched: no Thunderbird
 * tags, no IMAP keywords, nothing another client can see. Lookups key off
 * the Message-ID header so state follows a message across the archive move
 * that snoozing performs (which changes its numeric id).
 */

interface SnoozeIndex {
  messageIds: Set<number>;
  headerIds: Set<string>;
}

let pinKeys: Set<string> | null = null;
let snoozeIndex: SnoozeIndex | null = null;

const loadPinKeys = async (): Promise<Set<string>> => {
  pinKeys ??= new Set((await db.pins.toArray()).map((p) => p.key));
  return pinKeys;
};

const loadSnoozeIndex = async (): Promise<SnoozeIndex> => {
  if (!snoozeIndex) {
    const records = await db.snoozes.toArray();
    snoozeIndex = {
      messageIds: new Set(records.map((r) => r.messageId)),
      headerIds: new Set(
        records.map((r) => r.headerMessageId ?? "").filter(Boolean),
      ),
    };
  }
  return snoozeIndex;
};

/** Call after any db.snoozes write so subsequent lookups see the change. */
export const invalidateSnoozeIndex = (): void => {
  snoozeIndex = null;
};

export const setPinned = async (key: string, pinned: boolean): Promise<void> => {
  const keys = await loadPinKeys();
  if (pinned) {
    keys.add(key);
    await db.pins.put({ key, pinnedAt: Date.now() });
  } else {
    keys.delete(key);
    await db.pins.delete(key);
  }
};

export const isSnoozedHeader = async (
  header: { id: number; headerMessageId?: string },
): Promise<boolean> => {
  const index = await loadSnoozeIndex();
  if (index.messageIds.has(header.id)) return true;
  return !!header.headerMessageId && index.headerIds.has(header.headerMessageId);
};

/** Stamps local pin/snooze state onto a freshly built cache row. */
export const applyLocalState = async (raw: RawMessage): Promise<RawMessage> => {
  raw.pinned = (await loadPinKeys()).has(pinKeyOf(raw));
  raw.snoozed = await isSnoozedHeader(raw);
  return raw;
};

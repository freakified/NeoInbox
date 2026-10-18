import { pinKeyOf } from "../shared/pinKey";
import { db } from "../store/db";
import type { RawMessage, ResurfacedRecord } from "../shared/types";

/**
 * NeoInbox-local per-message state (pin, snooze). It lives entirely in the
 * extension's IndexedDB so the real mailbox is never touched: no Thunderbird
 * tags, no IMAP keywords, nothing another client can see. Lookups key off
 * the Message-ID header so state follows a message across the archive move
 * that snoozing performs (which changes its folder, and so its row key).
 */

interface SnoozeIndex {
  messageKeys: Set<string>;
  headerIds: Set<string>;
}

let pinKeys: Set<string> | null = null;
let resurfaced: Map<string, ResurfacedRecord> | null = null;
let snoozeIndex: SnoozeIndex | null = null;

const loadPinKeys = async (): Promise<Set<string>> => {
  pinKeys ??= new Set((await db.pins.toArray()).map((p) => p.key));
  return pinKeys;
};

const loadSnoozeIndex = async (): Promise<SnoozeIndex> => {
  if (!snoozeIndex) {
    const records = await db.snoozes.toArray();
    snoozeIndex = {
      messageKeys: new Set(records.map((r) => r.messageKey)),
      headerIds: new Set(records.map((r) => r.headerMessageId).filter(Boolean)),
    };
  }
  return snoozeIndex;
};

const loadResurfaced = async (): Promise<Map<string, ResurfacedRecord>> => {
  resurfaced ??= new Map((await db.resurfaced.toArray()).map((r) => [r.key, r]));
  return resurfaced;
};

/** Records where a woken (or unsnoozed) message sits in the stream. */
export const setResurfaced = async (
  key: string,
  resurfacedAt: number,
  snoozeExpired: boolean,
): Promise<void> => {
  const map = await loadResurfaced();
  const record = { key, resurfacedAt, snoozeExpired };
  map.set(key, record);
  await db.resurfaced.put(record);
};

/** Snoozing again or marking done ends the resurfaced position. */
export const clearResurfaced = async (key: string): Promise<void> => {
  const map = await loadResurfaced();
  if (!map.delete(key)) return;
  await db.resurfaced.delete(key);
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

/** A row (by key) or a bare header (by Message-ID) belonging to a snooze. */
export const isSnoozedHeader = async (
  header: { key?: string; headerMessageId?: string },
): Promise<boolean> => {
  const index = await loadSnoozeIndex();
  if (header.key !== undefined && index.messageKeys.has(header.key)) return true;
  return !!header.headerMessageId && index.headerIds.has(header.headerMessageId);
};

/** Stamps local pin/snooze/resurfaced state onto a freshly built cache row. */
export const applyLocalState = async (raw: RawMessage): Promise<RawMessage> => {
  const key = pinKeyOf(raw);
  raw.pinned = (await loadPinKeys()).has(key);
  raw.snoozed = await isSnoozedHeader(raw);
  const position = (await loadResurfaced()).get(key);
  if (position && raw.origin === "inbox" && !raw.snoozed) {
    raw.resurfacedAt = position.resurfacedAt;
    raw.snoozeExpired = position.snoozeExpired;
  }
  return raw;
};

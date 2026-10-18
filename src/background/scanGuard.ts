import type { MessageKey } from "../shared/messageKey";
import { db } from "../store/db";

/**
 * Coordinates long-running scans (backfill/reclassify) with the live event
 * handlers so a scan batch never resurrects a message deleted mid-scan, and
 * pruning never removes a message that was cached mid-scan.
 *
 * Dexie hooks observe every write to the messages table, so individual write
 * sites don't need to report anything. Both sets are append-only while a scan
 * is active and are cleared when the last scan ends.
 */
let activeScans = 0;
const removedDuringScan = new Set<MessageKey>();
const cachedDuringScan = new Set<MessageKey>();

db.messages.hook("creating", (primKey: MessageKey) => {
  if (activeScans) cachedDuringScan.add(primKey);
});
db.messages.hook("updating", (_mods: object, primKey: MessageKey) => {
  if (activeScans) cachedDuringScan.add(primKey);
});
db.messages.hook("deleting", (primKey: MessageKey) => {
  if (activeScans) removedDuringScan.add(primKey);
});

export const beginScan = (): void => {
  if (activeScans === 0) {
    removedDuringScan.clear();
    cachedDuringScan.clear();
  }
  activeScans++;
};

export const endScan = (): void => {
  activeScans = Math.max(0, activeScans - 1);
  if (activeScans === 0) {
    removedDuringScan.clear();
    cachedDuringScan.clear();
  }
};

export const scanActive = (): boolean => activeScans > 0;

export const wasRemovedDuringScan = (key: MessageKey): boolean => removedDuringScan.has(key);

export const wasCachedDuringScan = (key: MessageKey): boolean => cachedDuringScan.has(key);

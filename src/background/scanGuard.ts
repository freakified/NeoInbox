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
const removedDuringScan = new Set<number>();
const cachedDuringScan = new Set<number>();

db.messages.hook("creating", (primKey: number) => {
  if (activeScans) cachedDuringScan.add(primKey);
});
db.messages.hook("updating", (_mods: object, primKey: number) => {
  if (activeScans) cachedDuringScan.add(primKey);
});
db.messages.hook("deleting", (primKey: number) => {
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

export const wasRemovedDuringScan = (id: number): boolean => removedDuringScan.has(id);

export const wasCachedDuringScan = (id: number): boolean => cachedDuringScan.has(id);

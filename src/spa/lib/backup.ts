import { db } from "../../store/db";
import {
  type Backup,
  BACKUP_FORMAT,
  BACKUP_LOCAL_KEYS,
  BACKUP_STORAGE_KEYS,
  BACKUP_VERSION,
} from "../../shared/backup";

export const buildBackup = async (): Promise<Backup> => {
  const [customBundles, routeRules, pins, reminders, storage] = await Promise.all([
    db.customBundles.toArray(),
    db.routeRules.toArray(),
    db.pins.toArray(),
    db.reminders.toArray(),
    messenger.storage.local.get([...BACKUP_STORAGE_KEYS]),
  ]);
  const local: Record<string, string> = {};
  for (const key of BACKUP_LOCAL_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) local[key] = value;
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    customBundles,
    routeRules,
    pins,
    reminders,
    storage,
    localStorage: local,
  };
};

/** Saves the backup through the browser's download prompt. */
export const downloadBackup = (backup: Backup): void => {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `neoinbox-backup-${new Date(backup.exportedAt).toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "3 bundles, 12 rules, 2 pins, 1 reminder" */
export const describeBackup = (backup: Backup): string =>
  [
    plural(backup.customBundles.length, "bundle"),
    plural(backup.routeRules.length, "rule"),
    plural(backup.pins.length, "pin"),
    plural(backup.reminders.length, "reminder"),
  ].join(", ");

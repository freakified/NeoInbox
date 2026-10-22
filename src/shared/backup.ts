import type {
  CustomBundleRecord,
  PinRecord,
  ReminderRecord,
  RouteRuleRecord,
} from "./types";

/**
 * Settings → Advanced → Back up: what the user set up by hand, as one JSON
 * file. Everything else NeoInbox stores (cached mail, detected trips,
 * translations, scan progress) rebuilds itself, so it stays out. Importing
 * replaces rather than merges.
 *
 * Snoozes are left out too: a snooze is only half local state — the message
 * sits in the archive with its inbox row cached under the old key, and that
 * row is gone after a reinstall.
 */
export const BACKUP_FORMAT = "neoinbox-backup";
export const BACKUP_VERSION = 1;

/** storage.local keys a backup carries; the background reads these. */
export const BACKUP_STORAGE_KEYS = ["tripsEnabled", "openMode", "openOnStartup"] as const;

/**
 * localStorage keys a backup carries, as the raw strings stored. Each reader
 * already parses its value defensively, so they round-trip as is.
 */
export const BACKUP_LOCAL_KEYS = [
  "neoinbox.translationConfig",
  "neoinbox.remoteImagePolicy",
  "neoinbox.trustedImageSenders",
  "neoinbox.defaultAccount",
  "neoinbox.unifiedInbox",
] as const;

/** The part of a backup the background writes: IndexedDB and storage.local. */
export interface BackupData {
  customBundles: CustomBundleRecord[];
  routeRules: RouteRuleRecord[];
  pins: PinRecord[];
  reminders: ReminderRecord[];
  storage: Record<string, unknown>;
}

export interface Backup extends BackupData {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  /** Page settings in the SPA's localStorage, keyed as stored. */
  localStorage: Record<string, string>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): value is string => typeof value === "string";
const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const isBundle = (v: unknown): v is CustomBundleRecord =>
  isObject(v) && str(v.id) && str(v.name) && str(v.color) && str(v.icon) && num(v.order);

const isRule = (v: unknown): v is RouteRuleRecord =>
  isObject(v) && str(v.id) && str(v.target) && str(v.type) && str(v.value) && num(v.createdAt);

const isPin = (v: unknown): v is PinRecord => isObject(v) && str(v.key) && num(v.pinnedAt);

const isReminder = (v: unknown): v is ReminderRecord =>
  isObject(v) &&
  str(v.id) &&
  str(v.text) &&
  num(v.createdAt) &&
  (v.status === "active" || v.status === "done") &&
  typeof v.pinned === "boolean";

/** Every element must pass: a half-imported backup is worse than none. */
const list = <T>(value: unknown, check: (v: unknown) => v is T, what: string): T[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(check)) {
    throw new Error(`The backup's ${what} are damaged.`);
  }
  return value;
};

const pick = <T>(source: unknown, keys: readonly string[], check: (v: unknown) => v is T) => {
  const out: Record<string, T> = {};
  if (!isObject(source)) return out;
  for (const key of keys) if (check(source[key])) out[key] = source[key] as T;
  return out;
};

/** Reads a backup file's text; throws with a message fit to show the user. */
export const parseBackup = (text: string): Backup => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a NeoInbox backup.");
  }
  if (!isObject(raw) || raw.format !== BACKUP_FORMAT || !num(raw.version)) {
    throw new Error("That file isn't a NeoInbox backup.");
  }
  if (raw.version > BACKUP_VERSION) {
    throw new Error("That backup is from a newer NeoInbox. Update NeoInbox, then try again.");
  }
  return {
    format: BACKUP_FORMAT,
    version: raw.version,
    exportedAt: num(raw.exportedAt) ? raw.exportedAt : 0,
    customBundles: list(raw.customBundles, isBundle, "bundles"),
    routeRules: list(raw.routeRules, isRule, "rules"),
    pins: list(raw.pins, isPin, "pins"),
    reminders: list(raw.reminders, isReminder, "reminders"),
    storage: pick(raw.storage, BACKUP_STORAGE_KEYS, (v): v is unknown => v !== undefined),
    localStorage: pick(raw.localStorage, BACKUP_LOCAL_KEYS, str),
  };
};

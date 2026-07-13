import Dexie, { type Table, type Transaction } from "dexie";
import {
  LEGACY_PINNED_KEY,
  LEGACY_SNOOZED_KEY,
  sanitizeTags,
} from "../shared/categories";
import { pinKeyOf } from "../shared/pinKey";
import type {
  CustomBundleRecord,
  FolderCursorRecord,
  PinRecord,
  RawMessage,
  ReminderRecord,
  RouteRuleRecord,
  RouteRuleType,
  SnoozeRecord,
  TranslationRecord,
} from "../shared/types";

/** Pre-v7 record shapes, kept only for the migration below. */
interface LegacyOverrideRecord {
  senderDomain: string;
  category: string;
}
interface LegacyBundleRuleRecord {
  id: string;
  category: string;
  rule: { type: RouteRuleType; value: string };
  createdAt: number;
}
type LegacyCustomBundleRecord = CustomBundleRecord & {
  rules?: { type: RouteRuleType; value: string }[];
};

/**
 * Merge the three legacy rule stores into routeRules. One (type, value) key
 * routes to one target; on conflict the store that used to win at classify
 * time keeps the key (custom bundles < overrides < builtin email/subject rules).
 */
const migrateToRouteRules = async (tx: Transaction): Promise<void> => {
  const [overrides, bundleRules, customBundles] = await Promise.all([
    tx.table<LegacyOverrideRecord>("overrides").toArray(),
    tx.table<LegacyBundleRuleRecord>("bundleRules").toArray(),
    tx.table<LegacyCustomBundleRecord>("customBundles").toArray(),
  ]);

  const merged = new Map<string, RouteRuleRecord>();
  const put = (type: RouteRuleType, value: string, target: string, createdAt: number): void => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return;
    merged.set(`${type}:${normalized}`, {
      id: crypto.randomUUID(),
      target,
      type,
      value: normalized,
      createdAt,
    });
  };

  // Lowest precedence first; later puts overwrite earlier ones.
  for (const bundle of customBundles) {
    for (const rule of bundle.rules ?? []) put(rule.type, rule.value, bundle.id, 0);
  }
  for (const o of overrides) put("domain", o.senderDomain, o.category, 0);
  for (const row of bundleRules) {
    put(row.rule.type, row.rule.value, row.category, row.createdAt ?? 0);
  }

  await tx.table("routeRules").bulkPut([...merged.values()]);
  await tx.table("customBundles").toCollection().modify((bundle) => {
    delete (bundle as LegacyCustomBundleRecord).rules;
  });
};

/**
 * Pin/snooze state used to be stored as Thunderbird message tags. It now
 * lives only in this database: derive the new pinned/snoozed fields (and pin
 * records) from the cached tags, then drop our keys from the tags arrays.
 * The tags still on the server are stripped separately by cleanupLegacyTags.
 */
const migrateTagsToLocalState = async (tx: Transaction): Promise<void> => {
  const now = Date.now();
  const pins = new Map<string, PinRecord>();
  await tx.table<RawMessage>("messages").toCollection().modify((m) => {
    const tags: string[] = m.tags ?? [];
    m.snoozed = tags.includes(LEGACY_SNOOZED_KEY);
    m.pinned = m.pinned || tags.includes(LEGACY_PINNED_KEY);
    m.tags = sanitizeTags(tags);
    if (m.pinned) {
      const key = pinKeyOf(m);
      pins.set(key, { key, pinnedAt: now });
    }
  });
  if (pins.size) await tx.table("pins").bulkPut([...pins.values()]);

  const snoozes = await tx.table<SnoozeRecord>("snoozes").toArray();
  const fixed: SnoozeRecord[] = [];
  for (const record of snoozes) {
    if (record.headerMessageId) continue;
    const cached = await tx.table<RawMessage>("messages").get(record.messageId);
    if (cached?.headerMessageId) {
      fixed.push({ ...record, headerMessageId: cached.headerMessageId });
    }
  }
  if (fixed.length) await tx.table("snoozes").bulkPut(fixed);
};

class NeoInboxDb extends Dexie {
  messages!: Table<RawMessage, number>;
  snoozes!: Table<SnoozeRecord, number>;
  pins!: Table<PinRecord, string>;
  reminders!: Table<ReminderRecord, string>;
  routeRules!: Table<RouteRuleRecord, string>;
  folderCursors!: Table<FolderCursorRecord, string>;
  customBundles!: Table<CustomBundleRecord, string>;
  translations!: Table<TranslationRecord, string>;

  constructor() {
    super("neoinbox");
    this.version(1).stores({ snoozes: "messageId, wakeAt" });
    this.version(2).stores({
      messages: "id, date, accountId, folderId",
      snoozes: "messageId, wakeAt",
      overrides: "senderDomain",
      folderCursors: "folderId",
    });
    this.version(3).stores({
      customBundles: "id",
    });
    this.version(4).stores({
      messages: "id, date, accountId, folderId",
      snoozes: "messageId, wakeAt",
      overrides: "senderDomain",
      folderCursors: "folderId",
      customBundles: "id",
    });
    this.version(5).stores({
      messages: "id, date, accountId, folderId",
      snoozes: "messageId, wakeAt",
      overrides: "senderDomain",
      bundleRules: "id, category",
      folderCursors: "folderId",
      customBundles: "id",
    });
    this.version(6).stores({
      messages: "id, date, accountId, folderId",
      snoozes: "messageId, wakeAt",
      overrides: "senderDomain",
      bundleRules: "id, category",
      folderCursors: "folderId",
      customBundles: "id",
      translations: "id, messageId, targetLanguage, provider, createdAt",
    });
    this.version(7)
      .stores({
        routeRules: "id, target, &[type+value]",
      })
      .upgrade(migrateToRouteRules);
    this.version(8).stores({
      overrides: null,
      bundleRules: null,
    });
    this.version(9)
      .stores({
        pins: "key",
      })
      .upgrade(migrateTagsToLocalState);
    this.version(10).stores({
      reminders: "id, status, snoozeWakeAt",
    });
  }
}

export const db = new NeoInboxDb();

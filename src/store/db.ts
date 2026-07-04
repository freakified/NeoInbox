import Dexie, { type Table, type Transaction } from "dexie";
import type {
  CustomBundleRecord,
  FolderCursorRecord,
  RawMessage,
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

class NeoInboxDb extends Dexie {
  messages!: Table<RawMessage, number>;
  snoozes!: Table<SnoozeRecord, number>;
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
  }
}

export const db = new NeoInboxDb();

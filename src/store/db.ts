import Dexie, { type Table, type Transaction } from "dexie";
import { DETAILS_LAZY, MESSAGE_DETAILS_VERSION } from "../shared/details";
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
  ResurfacedRecord,
  ReminderRecord,
  ReservationRecord,
  RouteRuleRecord,
  RouteRuleType,
  SnoozeRecord,
  TranslationRecord,
  TripMembershipRecord,
  TripRecord,
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

/**
 * The Travel bundle is retired — travel mail is the trips layer or nothing.
 * Rules still pointing at it would render a stray grey "travel" bundle
 * (getCategoryMeta falls back to the raw key), so repoint them at the
 * unbundled inbox, and clear the category off any row that still carries it.
 * The CLASSIFIER_VERSION bump re-runs the pipeline over those rows anyway;
 * this just stops the dead category being visible in the meantime.
 */
const retireTravelCategory = async (tx: Transaction): Promise<void> => {
  await tx
    .table<RouteRuleRecord>("routeRules")
    .toCollection()
    .modify((rule) => {
      if (rule.target === "travel") rule.target = "personal";
    });
  await tx
    .table<RawMessage>("messages")
    .toCollection()
    .modify((m) => {
      if (m.category === "travel") {
        m.category = null;
        m.classifierVersion = 0;
      }
    });
};

class NeoInboxDb extends Dexie {
  messages!: Table<RawMessage, number>;
  snoozes!: Table<SnoozeRecord, number>;
  pins!: Table<PinRecord, string>;
  resurfaced!: Table<ResurfacedRecord, string>;
  reminders!: Table<ReminderRecord, string>;
  routeRules!: Table<RouteRuleRecord, string>;
  folderCursors!: Table<FolderCursorRecord, string>;
  customBundles!: Table<CustomBundleRecord, string>;
  translations!: Table<TranslationRecord, string>;
  trips!: Table<TripRecord, string>;
  tripMemberships!: Table<TripMembershipRecord, string>;
  reservations!: Table<ReservationRecord, string>;

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
    this.version(11).stores({
      trips: "id",
      tripMemberships: "key, tripId",
    });
    this.version(12).stores({
      reservations: "key, status",
    });
    // The version sweep used to find its work by reading every cached message
    // and filtering in memory, once per chunk. On a mailbox with tens of
    // thousands of archived rows that is a multi-second read repeated dozens of
    // times, which starves the UI. Index the stamp so the sweep can ask for
    // exactly the rows it needs. IndexedDB skips records whose index key is
    // undefined, so the upgrade has to give every existing row a real 0.
    this.version(13)
      .stores({
        messages: "id, date, accountId, folderId, [origin+classifierVersion]",
      })
      .upgrade(async (tx) => {
        await tx
          .table<RawMessage>("messages")
          .toCollection()
          .modify((m) => {
            m.classifierVersion ??= 0;
          });
      });
    this.version(14).upgrade(retireTravelCategory);
    // fillMissingDetails runs after every scan, including every incremental
    // one, and used to find its work the same way the version sweep did:
    // read every cached message, keep the handful still missing references.
    // Index the stamp so it can ask for exactly those. As in version 13,
    // undefined keys are left out of an IndexedDB index, so every row needs a
    // real number — and a row whose detail arrays never materialised has to
    // read as 0 whatever its stamp says, since that is the row needing work.
    this.version(15)
      .stores({
        messages:
          "id, date, accountId, folderId, detailsVersion, [origin+classifierVersion]",
      })
      .upgrade(async (tx) => {
        await tx
          .table<RawMessage>("messages")
          .toCollection()
          .modify((m) => {
            const hydrated =
              Array.isArray(m.attachments) &&
              Array.isArray(m.references) &&
              Array.isArray(m.inReplyTo);
            m.detailsVersion = hydrated ? m.detailsVersion ?? 0 : 0;
          });
      });
    // Sent and draft details are no longer fetched in the background: getting
    // References/In-Reply-To costs a body fetch each, and the details sweep was
    // working through a year of Sent one message at a time. Park the ones
    // already cached at DETAILS_LAZY so they fall outside the sweep's index
    // range; opening a conversation hydrates them.
    this.version(16).upgrade(async (tx) => {
      await tx
        .table<RawMessage>("messages")
        .toCollection()
        .modify((m) => {
          if (m.origin !== "sent" && m.origin !== "draft") return;
          if ((m.detailsVersion ?? 0) >= MESSAGE_DETAILS_VERSION) return;
          m.detailsVersion = DETAILS_LAZY;
        });
    });
    // The SPA no longer reads the whole table at startup: Sent and Done only
    // grow, so it pages them newest-first by [origin+date], and finds the old
    // Done mail a trip still shows by Message-ID.
    this.version(17).stores({
      messages:
        "id, date, accountId, folderId, detailsVersion, headerMessageId, [origin+date], [origin+classifierVersion]",
    });
    // MESSAGE_DETAILS_VERSION 3 adds the list snippet, which only inbox rows
    // go back for (see needsMessageDetails). Restamp everything else that was
    // complete under version 2, or the details sweep's index range would pull
    // a year of Sent back in on every scan just to filter it out again.
    this.version(18).upgrade(async (tx) => {
      await tx
        .table<RawMessage>("messages")
        .where("detailsVersion")
        .equals(2)
        .modify((m) => {
          if (m.origin !== "inbox") m.detailsVersion = 3;
        });
    });
    // Cc and Bcc joined RawMessage in May 2026, but rows cached before then
    // never got them: rescans take the unchanged fast path, and old Done mail
    // is never rescanned at all — yet trips load it (loadTripMembers), and
    // opening one crashed on the missing lists. The headers were never stored,
    // so empty is all there is to give them.
    this.version(19).upgrade(async (tx) => {
      await tx
        .table<RawMessage>("messages")
        .toCollection()
        .modify((m) => {
          if (!Array.isArray(m.recipients)) m.recipients = [];
          if (!Array.isArray(m.ccList)) m.ccList = [];
          if (!Array.isArray(m.bccList)) m.bccList = [];
        });
    });
    // A snooze wake's stream position used to live only on the cached row,
    // keyed by numeric id; when the move back to the inbox renumbered the
    // message, the next scan rebuilt the row without it and the thread sank
    // back to its original date. Keep it beside pins, keyed by Message-ID.
    this.version(20).stores({ resurfaced: "key" });
  }
}

export const db = new NeoInboxDb();

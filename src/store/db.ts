import Dexie, { type Table } from "dexie";
import type { MessageKey } from "../shared/messageKey";
import type {
  CustomBundleRecord,
  FolderCursorRecord,
  PinRecord,
  RawMessage,
  ResurfacedRecord,
  ReminderRecord,
  ReservationRecord,
  RouteRuleRecord,
  SnoozeRecord,
  TranslationRecord,
  TripMembershipRecord,
  TripRecord,
} from "../shared/types";

/**
 * One schema, no upgrades: there is no installed base to migrate yet. Once
 * there is, a new RawMessage field or index needs a version bump with an
 * upgrade that backfills it — archived rows are never rescanned, so nothing
 * else will.
 */
class NeoInboxDb extends Dexie {
  messages!: Table<RawMessage, MessageKey>;
  snoozes!: Table<SnoozeRecord, MessageKey>;
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
    this.version(1).stores({
      // detailsVersion and [origin+classifierVersion] drive the background
      // sweeps; IndexedDB leaves rows with an undefined index key out, so
      // writers always stamp both. [origin+date] pages Sent and Done, and
      // headerMessageId finds the Done mail a trip shows.
      messages:
        "key, tbId, date, accountId, folderId, detailsVersion, headerMessageId, [origin+date], [origin+classifierVersion]",
      snoozes: "messageKey, wakeAt",
      pins: "key",
      resurfaced: "key",
      reminders: "id, status, snoozeWakeAt",
      routeRules: "id, target, &[type+value]",
      folderCursors: "folderId",
      customBundles: "id",
      translations: "id, messageKey, targetLanguage, provider, createdAt",
      trips: "id",
      tripMemberships: "key, tripId",
      reservations: "key, status",
    });
  }
}

export const db = new NeoInboxDb();

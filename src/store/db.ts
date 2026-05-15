import Dexie, { type Table } from "dexie";
import type {
  CustomBundleRecord,
  BundleRuleRecord,
  FolderCursorRecord,
  OverrideRecord,
  RawMessage,
  SnoozeRecord,
  TranslationRecord,
} from "../shared/types";

class NeoInboxDb extends Dexie {
  messages!: Table<RawMessage, number>;
  snoozes!: Table<SnoozeRecord, number>;
  overrides!: Table<OverrideRecord, string>;
  bundleRules!: Table<BundleRuleRecord, string>;
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
  }
}

export const db = new NeoInboxDb();

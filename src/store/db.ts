import Dexie, { type Table } from "dexie";
import type {
  CustomBundleRecord,
  FolderCursorRecord,
  OverrideRecord,
  RawMessage,
  SnoozeRecord,
} from "../shared/types";

class NeoInboxDb extends Dexie {
  messages!: Table<RawMessage, number>;
  snoozes!: Table<SnoozeRecord, number>;
  overrides!: Table<OverrideRecord, string>;
  folderCursors!: Table<FolderCursorRecord, string>;
  customBundles!: Table<CustomBundleRecord, string>;

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
  }
}

export const db = new NeoInboxDb();

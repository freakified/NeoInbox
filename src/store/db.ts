import Dexie, { type Table } from "dexie";
import type { SnoozeRecord } from "../shared/types";

class NeoInboxDb extends Dexie {
  snoozes!: Table<SnoozeRecord, number>;

  constructor() {
    super("neoinbox");
    this.version(1).stores({ snoozes: "messageId, wakeAt" });
  }
}

export const db = new NeoInboxDb();

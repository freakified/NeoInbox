import type { Category, Delta } from "./types";

export const PORT_NAME = "neoinbox";

export type ClientMsg =
  | { type: "hello" }
  | { type: "pin"; messageId: number; pinned: boolean }
  | { type: "done"; messageId: number }
  | { type: "snooze"; messageId: number; wakeAt: number }
  | { type: "trash"; messageId: number }
  | { type: "reclassify" }
  | { type: "override"; senderDomain: string; category: Category | null };

export type ServerMsg =
  | ({ type: "delta" } & Delta)
  | { type: "myEmails"; emails: string[] }
  | { type: "backfill-progress"; scanned: number; tagged: number; done: boolean }
  | { type: "error"; message: string };

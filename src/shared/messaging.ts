export type Request =
  | { type: "ping" }
  | { type: "backfill" }
  | { type: "pin"; messageId: number; pinned: boolean }
  | { type: "snooze"; messageId: number; wakeAt: number }
  | { type: "done"; messageId: number; accountId: string }
  | { type: "trash"; messageId: number };

export type Response =
  | { type: "pong"; ts: number }
  | { type: "ok" }
  | { type: "backfilled"; scanned: number; tagged: number }
  | { type: "error"; message: string };

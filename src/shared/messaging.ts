import type { CustomBundleRecord, Delta, RouteRuleRecord } from "./types";

export const PORT_NAME = "neoinbox";

export type ClientMsg =
  | { type: "hello" }
  | { type: "pin"; messageId: number; pinned: boolean }
  | { type: "done"; messageId: number }
  | { type: "snooze"; messageId: number; wakeAt: number }
  | { type: "unsnooze"; messageId: number }
  | { type: "trash"; messageId: number }
  | { type: "move-to-inbox"; messageId: number }
  | { type: "set-route-rule"; rule: RouteRuleRecord }
  | { type: "delete-route-rule"; id: string }
  | { type: "set-custom-bundle"; bundle: CustomBundleRecord }
  | { type: "delete-custom-bundle"; id: string }
  | { type: "retry-backfill" }
  /** Re-run the classify pipeline; all cached inbox messages when no ids given. */
  | { type: "reclassify"; messageIds?: number[] };

export type FailedCommand = "done" | "snooze" | "unsnooze" | "trash" | "move-to-inbox";

export type ServerMsg =
  | ({ type: "delta" } & Delta)
  | { type: "myEmails"; emails: string[] }
  | {
      type: "backfill-progress";
      scanned: number;
      classified: number;
      done: boolean;
      error?: string;
    }
  | {
      type: "command-failed";
      command: FailedCommand;
      messageId: number;
      reason: string;
    }
  | { type: "reclassify-done"; scanned: number; moved: number }
  | { type: "error"; message: string };

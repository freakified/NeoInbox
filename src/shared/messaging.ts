import type { BuiltinCategory, BundleRuleRecord, CustomBundleRecord, Delta } from "./types";

export const PORT_NAME = "neoinbox";

export type ClientMsg =
  | { type: "hello" }
  | { type: "pin"; messageId: number; pinned: boolean }
  | { type: "done"; messageId: number }
  | { type: "snooze"; messageId: number; wakeAt: number }
  | { type: "trash"; messageId: number }
  | { type: "override"; senderDomain: string; category: BuiltinCategory | null }
  | { type: "set-bundle-rule"; rule: BundleRuleRecord }
  | { type: "delete-bundle-rule"; id: string }
  | { type: "set-custom-bundle"; bundle: CustomBundleRecord }
  | { type: "delete-custom-bundle"; id: string }
  | { type: "retry-backfill" };

export type FailedCommand = "done" | "snooze" | "trash";

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
  | { type: "error"; message: string };

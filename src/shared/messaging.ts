import type { ComposeDraft } from "./compose";
import type {
  CustomBundleRecord,
  Delta,
  RouteRuleRecord,
  TripMembershipRecord,
  TripRecord,
} from "./types";

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
  /**
   * Fetch the details (References/In-Reply-To, attachments) of rows cached
   * from their headers alone — sent and draft mail. Sent by the SPA when a
   * conversation is opened, which is the only time those headers matter.
   */
  | { type: "hydrate-details"; messageIds: number[] }
  /** Widen the inbox scan window by one step and rescan. */
  | { type: "load-more-inbox" }
  /** Re-run the classify pipeline; all cached inbox messages when no ids given. */
  | { type: "reclassify"; messageIds?: number[] }
  /**
   * Fill a Thunderbird compose window from an inline draft, then send it
   * (`send`) or leave it open for the user to finish.
   */
  | { type: "compose"; requestId: string; draft: ComposeDraft; send: boolean };

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
  /**
   * How far into the inbox the last full scan reached. `skipped` counts the
   * older messages left outside the window, so the SPA knows whether to offer
   * Load more.
   */
  | { type: "inbox-window"; cap: number; skipped: number }
  /**
   * Auto-clusterer output (already persisted to Dexie by the background).
   * memberships only ever carry source "auto" rows; the SPA must keep any
   * local manual row over an incoming auto row for the same key.
   */
  | {
      type: "trips-delta";
      trips: TripRecord[];
      removedTripIds: string[];
      memberships: TripMembershipRecord[];
      removedMembershipKeys: string[];
    }
  /**
   * How a `compose` command ended. "failed" leaves the compose window open
   * (Thunderbird shows its own error), so the draft is never lost.
   */
  | {
      type: "compose-result";
      requestId: string;
      outcome: "sent" | "opened" | "failed";
      error?: string;
    }
  | { type: "error"; message: string };

import type { ComposeDraft } from "./compose";
import type { MessageKey } from "./messageKey";
import type {
  CustomBundleRecord,
  Delta,
  RouteRuleRecord,
  TripMembershipRecord,
  TripRecord,
} from "./types";

export const PORT_NAME = "neoinbox";

/**
 * An SPA trip edit. The background is the only writer to trips and
 * tripMemberships, so these queue behind the auto-clusterer instead of racing
 * it. deleteTripIds names trips the SPA believes are now empty; the background
 * re-checks that against the stored memberships before deleting.
 */
export interface TripWrite {
  trips: TripRecord[];
  memberships: TripMembershipRecord[];
  deleteTripIds: string[];
  deleteMembershipKeys: string[];
}

export type ClientMsg =
  | { type: "hello" }
  | { type: "pin"; messageKey: MessageKey; pinned: boolean }
  | { type: "done"; messageKey: MessageKey }
  | { type: "snooze"; messageKey: MessageKey; wakeAt: number }
  | { type: "unsnooze"; messageKey: MessageKey }
  | { type: "trash"; messageKey: MessageKey }
  | { type: "move-to-inbox"; messageKey: MessageKey }
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
  | { type: "hydrate-details"; messageKeys: MessageKey[] }
  /** Widen the inbox scan window by one step and rescan. */
  | { type: "load-more-inbox" }
  /** Re-run the classify pipeline; all cached inbox messages when no ids given. */
  | { type: "reclassify"; messageKeys?: MessageKey[] }
  /**
   * Fill a Thunderbird compose window from an inline draft, then send it
   * (`send`) or leave it open for the user to finish.
   */
  | { type: "compose"; requestId: string; draft: ComposeDraft; send: boolean }
  /**
   * Settings → Trips. `archive` reads archived mail as well as the inbox;
   * `rebuild` deletes the auto-built trips and re-reads everything first.
   */
  | { type: "trip-scan"; archive: boolean; rebuild?: boolean }
  | { type: "trip-scan-cancel" }
  /**
   * Settings → Archive: cache archived mail from headers alone, back to
   * `since` (ms; null for everything). Never fetches a body.
   */
  | { type: "archive-import"; since: number | null }
  | { type: "archive-import-cancel" }
  | ({ type: "write-trips" } & TripWrite);

/** Progress of the archive trip scan; the last finished one is persisted. */
export interface TripScanStatus {
  running: boolean;
  /** This run included archived mail. */
  archive: boolean;
  rebuild?: boolean;
  /** Messages read so far / to read this run (already-read ones excluded). */
  processed: number;
  total: number;
  /** Trips after the run. */
  trips?: number;
  finishedAt?: number;
  cancelled?: boolean;
  error?: string;
  /** When an archive scan last finished (any run), so Rebuild can redo it. */
  archiveScannedAt?: number;
}

/** Progress of the archive import; the last finished one is persisted. */
export interface ArchiveImportStatus {
  running: boolean;
  /** Oldest date imported (ms); null means the whole archive. */
  since: number | null;
  /** Archived headers looked at so far. */
  scanned: number;
  /** New Done rows written so far. */
  imported: number;
  /** Archive folders done / to do this run. */
  folders: number;
  totalFolders: number;
  finishedAt?: number;
  cancelled?: boolean;
  error?: string;
}

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
      messageKey: MessageKey;
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
   * Trip rows already persisted to Dexie by the background. Auto-clusterer
   * output only ever carries auto rows, and the SPA must keep any local manual
   * row over them for the same key. `authoritative` deltas (a write-trips
   * echo, a full reset) are what the database now holds and apply as is.
   */
  | {
      type: "trips-delta";
      authoritative: boolean;
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
  | ({ type: "trip-scan-progress" } & TripScanStatus)
  | ({ type: "archive-import-progress" } & ArchiveImportStatus)
  | { type: "error"; message: string };

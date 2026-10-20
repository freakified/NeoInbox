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
  /** Report spam: move to the account's Junk folder and flag it as junk. */
  | { type: "spam"; messageKey: MessageKey }
  | { type: "move-to-inbox"; messageKey: MessageKey }
  /**
   * Set Thunderbird's read flag, which syncs to the server like any client's.
   * Sent when a conversation is opened; like Inbox, there is no way back.
   */
  | { type: "mark-read"; messageKeys: MessageKey[] }
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
  /**
   * Settings → Trips: turn trips on or off. Travel mail moves between
   * Updates and the Travel bundle, and trips are swept again when turned on.
   */
  | { type: "set-trips-enabled"; enabled: boolean }
  /** Re-run the classify pipeline; all cached inbox messages when no ids given. */
  | { type: "reclassify"; messageKeys?: MessageKey[] }
  /**
   * Fill a Thunderbird compose window from an inline draft, then send it
   * (`send`) or leave it open for the user to finish.
   */
  | { type: "compose"; requestId: string; draft: ComposeDraft; send: boolean }
  /**
   * Settings → Trips, and the Trips view's footer. `archive` reads archived
   * mail, and older inbox mail cached from headers, as well as the inbox;
   * `rebuild` deletes the auto-built trips and re-reads everything first.
   * `importSince` (ms; null for everything) first imports the archive back
   * that far, unless an earlier import already did; `inboxSince` does the
   * same for older inbox mail (Settings → Older mail → Inbox).
   */
  | {
      type: "trip-scan";
      archive: boolean;
      rebuild?: boolean;
      importSince?: number | null;
      inboxSince?: number | null;
    }
  | { type: "trip-scan-cancel" }
  /**
   * Settings → Advanced: cache archived mail from headers alone, back to
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
  /**
   * How far back the last finished archive scan read (ms; null for the whole
   * archive): the archive import's coverage when it ran. Unset when unknown.
   */
  scannedBackTo?: number | null;
  /** While running: importing the archive first, or reading messages. */
  phase?: "import" | "read";
  /** This run imported older inbox mail first (`inboxSince`), not the archive. */
  fromInbox?: boolean;
}

/**
 * Progress of the archive import; the last finished one is persisted. The
 * inbox import reports the same shape. Both list headers first, then read
 * each listed message in full (see fullRead.ts); the listing fields below
 * describe the first pass.
 */
export interface ArchiveImportStatus {
  running: boolean;
  /** While running: listing headers, or reading the messages in full. */
  phase?: "headers" | "bodies";
  /** Messages read in full so far / to read this run. */
  sorted?: number;
  toSort?: number;
  /** Oldest date imported (ms); null means the whole archive. */
  since: number | null;
  /** Archived headers looked at so far. */
  scanned: number;
  /** New Done rows written so far. */
  imported: number;
  /**
   * Oldest date every finished import together reaches back to (ms; null for
   * the whole archive). Unset until one finishes. Survives later, shallower
   * imports, so a 1-year import after a 5-year one still reads as 5 years.
   */
  coveredSince?: number | null;
  /** Archive folders done / to do this run. */
  folders: number;
  totalFolders: number;
  /**
   * Headers this run will look at, when knowable: only a whole-archive run,
   * since folders report their size but not how much of it a range covers.
   */
  total?: number;
  finishedAt?: number;
  cancelled?: boolean;
  error?: string;
}

/**
 * Progress of the inbox import (inboxImport.ts): `since` and `coveredSince`
 * are how far back older inbox mail was listed, `folders` count inboxes.
 */
export type InboxImportStatus = ArchiveImportStatus;

export type FailedCommand = "done" | "snooze" | "unsnooze" | "trash" | "spam" | "move-to-inbox";

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
   * inbox messages with no cached row — older than the window and not
   * imported — so the SPA knows whether to offer Settings → Older mail.
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
  | ({ type: "inbox-import-progress" } & InboxImportStatus)
  | { type: "error"; message: string };

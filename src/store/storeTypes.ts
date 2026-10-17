import type { ComposeDraft } from "../shared/compose";
import type { FailedCommand, TripScanStatus } from "../shared/messaging";
import type {
  Category,
  CustomBundleRecord,
  RawMessage,
  ReminderRecord,
  RouteRuleRecord,
  SnoozeRecord,
  Thread,
  TripMembershipRecord,
  TripRecord,
} from "../shared/types";

export interface SyncProgress {
  scanned: number;
  classified: number;
  done: boolean;
  error: string | null;
}

export type ConnectionState = "connected" | "reconnecting";

export type PendingOp =
  | { kind: "done"; message: RawMessage }
  | { kind: "snooze"; message: RawMessage; wakeAt: number }
  | { kind: "unsnooze"; message: RawMessage; snooze?: SnoozeRecord }
  | { kind: "trash"; message: RawMessage }
  | { kind: "moveToInbox"; message: RawMessage };

export interface ToastAction {
  label: string;
  run: () => void;
}

/**
 * A reply just handed to Thunderbird to send, shown at the bottom of its
 * conversation until the real Sent copy threads in (see ThreadView).
 */
export interface PendingReply {
  requestId: string;
  threadId: string;
  /** Messages already in the thread, so the Sent copy is the one that's new. */
  knownIds: number[];
  author: string;
  to: string[];
  cc: string[];
  text: string;
  html?: string;
  date: number;
  status: "sending" | "sent";
}

export interface ToastRecord {
  id: string;
  message: string;
  retry?: { kind: FailedCommand; messageId: number; wakeAt?: number };
  undo?: { messageIds: number[]; kind: "done" | "trash" };
  actions?: ToastAction[];
}

/**
 * A request to open the bundle settings modal. Lives in the store (not
 * component state) so toast actions can open it after the originating thread
 * row has unmounted; `thread` is a snapshot for seeding rules from it.
 */
export interface BundleSettingsRequest {
  category?: Category | null;
  thread?: Thread;
  highlightRuleId?: string;
  startNewBundle?: boolean;
}

export interface MailStore {
  messagesById: Record<number, RawMessage>;
  myEmails: ReadonlySet<string>;
  hydrated: boolean;
  syncProgress: SyncProgress | null;
  /**
   * How far the last full scan reached into the inbox. Null until a full scan
   * reports; `skipped: 0` means the whole inbox is in the window.
   */
  inboxWindow: { cap: number; skipped: number } | null;
  loadingMoreInbox: boolean;
  customBundles: CustomBundleRecord[];
  routeRules: RouteRuleRecord[];
  connectionState: ConnectionState;
  pendingOps: Record<number, PendingOp>;
  snoozesByMessageId: Record<number, SnoozeRecord>;
  remindersById: Record<string, ReminderRecord>;
  tripsById: Record<string, TripRecord>;
  tripMembershipByKey: Record<string, TripMembershipRecord>;
  toasts: ToastRecord[];
  pendingReplies: PendingReply[];
  bundleSettings: BundleSettingsRequest | null;
  reclassifying: boolean;
  /** The Settings → Trips scan: running progress, else the last result. */
  tripScan: TripScanStatus | null;
  /**
   * Every Sent and Done row dated from here on is in messagesById; older ones
   * stay in Dexie until a view asks for them. 0 means all of them are loaded.
   */
  historyFrom: number;
  loadingHistory: boolean;

  init: () => Promise<void>;
  /** Page the next-older Sent and Done mail into memory. */
  loadOlderHistory: () => Promise<void>;
  pin: (messageId: number, pinned: boolean) => void;
  doneThread: (messageIds: number[]) => void;
  snoozeThread: (messageIds: number[], wakeAt: number) => void;
  unsnoozeThread: (messageIds: number[]) => void;
  trashThread: (messageIds: number[]) => void;
  /** Restore done (archived) messages to their account's inbox. */
  moveToInboxThread: (messageIds: number[]) => void;
  setRouteRule: (rule: RouteRuleRecord) => void;
  deleteRouteRule: (id: string) => void;
  applyCategoryLocally: (messageIds: number[], category: Category | null) => void;
  setCustomBundle: (bundle: CustomBundleRecord) => void;
  deleteCustomBundle: (id: string) => void;
  createReminder: (text: string) => void;
  updateReminderText: (id: string, text: string) => void;
  setReminderPinned: (id: string, pinned: boolean) => void;
  snoozeReminder: (id: string, wakeAt: number) => void;
  unsnoozeReminder: (id: string) => void;
  doneReminder: (id: string) => void;
  restoreReminder: (id: string) => void;
  deleteReminder: (id: string) => void;
  /** Resurface snoozed reminders whose wake time has passed. */
  wakeDueReminders: () => void;
  /**
   * A cached row's TB id turned out stale (see resolveLiveMessageId): re-key
   * the row to the verified live id, or drop it when the live id is already
   * cached as its own row. Returns false when the row is left as is (snoozed
   * rows keep their id), in which case the caller should use the live id.
   */
  healStaleMessage: (staleId: number, liveId: number) => boolean;
  createTrip: (name: string) => TripRecord;
  renameTrip: (id: string, name: string) => void;
  /**
   * Assign messages (by pinKey) to a trip; null removes them from all trips
   * and, as a tombstone, keeps auto-clustering (phase 2) from re-adding them.
   */
  setTripMembership: (keys: string[], tripId: string | null) => void;
  retryBackfill: () => void;
  /** Fetch details for a conversation's headers-only rows as it opens. */
  hydrateThreadDetails: (messageIds: number[]) => void;
  /** Widen the inbox scan window by one step and rescan. */
  loadMoreInbox: () => void;
  retryToast: (toastId: string) => void;
  undoToast: (toastId: string) => void;
  dismissToast: (toastId: string) => void;
  notify: (message: string, actions?: ToastAction[]) => void;
  openBundleSettings: (request: BundleSettingsRequest) => void;
  closeBundleSettings: () => void;
  /** Re-run bundling rules in the background; whole inbox when no ids given. */
  reclassify: (messageIds?: number[]) => void;
  /** Find trips (in archived mail too when `archive`); `rebuild` starts over. */
  scanTrips: (options: { archive: boolean; rebuild?: boolean }) => void;
  stopTripScan: () => void;
  /**
   * Hand an inline draft to Thunderbird: send it, or open it in a compose
   * window for the user to finish when `send` is false.
   */
  composeMessage: (
    draft: ComposeDraft,
    send: boolean,
    pending?: Omit<PendingReply, "requestId" | "date" | "status">,
  ) => void;
  /** The reply's Sent copy has shown up in its thread (or never will). */
  settlePendingReply: (requestId: string) => void;
  /** A new message someone asked the FAB's composer to open, prefilled. */
  newMessageRequest: (NewMessagePrefill & { key: number }) | null;
  startNewMessage: (prefill: NewMessagePrefill) => void;
  clearNewMessageRequest: () => void;
}

export interface NewMessagePrefill {
  subject: string;
  text: string;
  html: string;
}

export type StoreSet = (partial: Partial<MailStore>) => void;
export type StoreGet = () => MailStore;

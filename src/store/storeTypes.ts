import type { ComposeDraft } from "../shared/compose";
import type { MessageKey } from "../shared/messageKey";
import type { ThreadRef } from "../shared/threading";
import type { ArchiveImportStatus, FailedCommand, TripScanStatus } from "../shared/messaging";
import type { ComposerValue } from "../spa/components/ComposerForm";
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
  knownKeys: MessageKey[];
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
  retry?: { kind: FailedCommand; messageKey: MessageKey; wakeAt?: number };
  undo?: { messageKeys: MessageKey[]; kind: "done" | "trash" };
  actions?: ToastAction[];
}

/**
 * A request to open the bundle settings modal. Lives in the store (not
 * component state) so toast actions can open it after the originating thread
 * row has unmounted; `thread` is a snapshot for seeding rules from it.
 */
export interface BundleSettingsRequest {
  /** Open on one of the non-bundle panes instead. */
  pane?: "general" | "privacy" | "translation" | "advanced" | "accounts" | "archive" | "trips";
  category?: Category | null;
  thread?: Thread;
  highlightRuleId?: string;
  startNewBundle?: boolean;
}

export interface MailStore {
  messagesByKey: Record<MessageKey, RawMessage>;
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
  pendingOps: Record<MessageKey, PendingOp>;
  snoozesByKey: Record<MessageKey, SnoozeRecord>;
  remindersById: Record<string, ReminderRecord>;
  tripsById: Record<string, TripRecord>;
  tripMembershipByKey: Record<string, TripMembershipRecord>;
  toasts: ToastRecord[];
  pendingReplies: PendingReply[];
  bundleSettings: BundleSettingsRequest | null;
  reclassifying: boolean;
  /** The Settings → Trips scan: running progress, else the last result. */
  tripScan: TripScanStatus | null;
  /** Settings → Advanced: the running import, else the last one. */
  archiveImport: ArchiveImportStatus | null;
  /**
   * Every Sent and Done row dated from here on is in messagesByKey; older ones
   * stay in Dexie until a view asks for them. 0 means all of them are loaded.
   */
  historyFrom: number;
  loadingHistory: boolean;
  /** The search view's lookup in Dexie: the query it was for, and whether it's still reading. */
  search: { query: string; loading: boolean } | null;
  /** The one account the stream shows; null shows every account's mail. */
  accountFilter: string | null;
  setAccountFilter: (accountId: string | null) => void;

  init: () => Promise<void>;
  /** Page the next-older Sent and Done mail into memory. */
  loadOlderHistory: () => Promise<void>;
  /** Re-read the newest Sent/Done page, e.g. after an archive import. */
  reloadHistory: () => Promise<void>;
  /** Load every cached message matching `query` into memory, however old. */
  searchMail: (query: string) => Promise<void>;
  pin: (messageKey: MessageKey, pinned: boolean) => void;
  doneThread: (messageKeys: MessageKey[]) => void;
  snoozeThread: (messageKeys: MessageKey[], wakeAt: number) => void;
  unsnoozeThread: (messageKeys: MessageKey[]) => void;
  trashThread: (messageKeys: MessageKey[]) => void;
  /** Restore done (archived) messages to their account's inbox. */
  moveToInboxThread: (messageKeys: MessageKey[]) => void;
  setRouteRule: (rule: RouteRuleRecord) => void;
  deleteRouteRule: (id: string) => void;
  applyCategoryLocally: (messageKeys: MessageKey[], category: Category | null) => void;
  setCustomBundle: (bundle: CustomBundleRecord) => void;
  deleteCustomBundle: (id: string) => void;
  /** A new reminder, optionally pinned or snoozed from the start. */
  createReminder: (text: string, options?: { pinned?: boolean; snoozeWakeAt?: number }) => void;
  updateReminderText: (id: string, text: string) => void;
  setReminderPinned: (id: string, pinned: boolean) => void;
  snoozeReminder: (id: string, wakeAt: number) => void;
  unsnoozeReminder: (id: string) => void;
  doneReminder: (id: string) => void;
  restoreReminder: (id: string) => void;
  deleteReminder: (id: string) => void;
  /** Resurface snoozed reminders whose wake time has passed. */
  wakeDueReminders: () => void;
  createTrip: (name: string) => TripRecord;
  renameTrip: (id: string, name: string) => void;
  /**
   * Assign messages (by pinKey) to a trip; null removes them from all trips
   * and, as a tombstone, keeps auto-clustering (phase 2) from re-adding them.
   */
  setTripMembership: (keys: string[], tripId: string | null) => void;
  retryBackfill: () => void;
  /** Fetch details for a conversation's headers-only rows as it opens. */
  hydrateThreadDetails: (messageKeys: MessageKey[]) => void;
  /** Widen the inbox scan window by one step and rescan. */
  loadMoreInbox: () => void;
  retryToast: (toastId: string) => void;
  undoToast: (toastId: string) => void;
  dismissToast: (toastId: string) => void;
  notify: (message: string, actions?: ToastAction[]) => void;
  openBundleSettings: (request: BundleSettingsRequest) => void;
  closeBundleSettings: () => void;
  /** Re-run bundling rules in the background; whole inbox when no ids given. */
  reclassify: (messageKeys?: MessageKey[]) => void;
  /** Find trips (in archived mail too when `archive`); `rebuild` starts over. */
  /** `importSince` imports the archive back that far first (null: everything). */
  scanTrips: (options: { archive: boolean; rebuild?: boolean; importSince?: number | null }) => void;
  stopTripScan: () => void;
  /** Cache archived mail from headers alone, back to `since` (null: all of it). */
  importArchive: (since: number | null) => void;
  stopArchiveImport: () => void;
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
  /** An in-thread reply popped out into the floating compose panel. */
  poppedReply: PoppedReply | null;
  popOutReply: (reply: Omit<PoppedReply, "key">) => void;
  clearPoppedReply: () => void;
}

/**
 * A reply moved from its thread into the floating panel. The thread's
 * InlineReply supplies the callbacks, so sending still threads the reply.
 */
export interface PoppedReply {
  key: number;
  /** By its messages too: the thread's id may change while the reply is out. */
  thread: ThreadRef;
  /** Shown in the panel's title bar, e.g. "Re: Dinner Friday". */
  title: string;
  value: ComposerValue;
  identityContext: { accountId?: string; addresses?: readonly string[] };
  placeholder: string;
  submit: (value: ComposerValue, send: boolean, identityId: string | undefined) => void;
  /** Closed without sending: hand what's written back to the thread. */
  keep: (value: ComposerValue) => void;
  discard: (value: ComposerValue) => void;
}

export interface NewMessagePrefill {
  subject: string;
  text: string;
  html: string;
}

export type StoreSet = (partial: Partial<MailStore>) => void;
export type StoreGet = () => MailStore;

export type BuiltinCategory =
  | "travel"
  | "finance"
  | "purchases"
  | "social"
  | "updates"
  | "promos"
  | "forums"
  | "personal";

export type Category = string;
export type MessageOrigin = "inbox" | "sent" | "draft" | "done";

export type RouteRuleType = "domain" | "email" | "subject_keyword";

/**
 * A routing key: one (type, value) pair maps to exactly one target.
 * `target` is a builtin category name, a custom bundle id, or "personal"
 * (explicitly routed to the unbundled inbox).
 */
export interface RouteRuleRecord {
  id: string;
  target: Category;
  type: RouteRuleType;
  value: string;
  createdAt: number;
}

export interface CustomBundleRecord {
  id: string;
  name: string;
  color: string;
  icon: string;
  order: number;
}

export interface AttachmentSummary {
  name: string;
  contentType: string;
  size: number;
  partName: string;
}

export interface RawMessage {
  id: number;
  headerMessageId: string;
  subject: string;
  author: string;
  recipients: string[];
  ccList: string[];
  bccList: string[];
  date: number;
  resurfacedAt?: number;
  size: number;
  read: boolean;
  folderId: string;
  accountId: string;
  tags: string[];
  category: Category | null;
  /** NeoInbox-local state; never written to Thunderbird or the mail server. */
  pinned: boolean;
  /** NeoInbox-local state; never written to Thunderbird or the mail server. */
  snoozed: boolean;
  origin: MessageOrigin;
  references?: string[];
  inReplyTo?: string[];
  attachments?: AttachmentSummary[];
  detailsVersion?: number;
  /**
   * True when this row's category was decided without the full message body
   * (getFull() failed, usually because IMAP hadn't synced it yet), so
   * heuristics keyed on body/List-* headers may have missed. Retried by the
   * backfill sweep once the body is available.
   */
  classifiedIncomplete?: boolean;
}

export interface Thread {
  id: string;
  subject: string;
  messages: RawMessage[];
  participantsLabel: string;
  latestDate: number;
  unreadCount: number;
  pinned: boolean;
  category: Category | null;
  accountId: string;
  hasMe: boolean;
  snoozeDueAt?: number;
  /** Set when the thread's stream position comes from a snooze wake rather than a new message. */
  resurfacedAt?: number;
}

/**
 * A standalone reminder in the stream. NeoInbox-local: never written to
 * Thunderbird or the mail server. A snoozed reminder keeps status "active"
 * with snoozeWakeAt set; waking clears it and stamps resurfacedAt.
 */
export interface ReminderRecord {
  id: string;
  text: string;
  createdAt: number;
  status: "active" | "done";
  pinned: boolean;
  /** When a snoozed reminder returns to the inbox; unset = not snoozed. */
  snoozeWakeAt?: number;
  /** Set when the reminder's stream position comes from a snooze wake. */
  resurfacedAt?: number;
  doneAt?: number;
}

/**
 * A trip: an explicit, user-visible grouping of travel mail, shown as trip
 * cards inside the Trips bundle. NeoInbox-local. Membership lives in
 * TripMembershipRecord rows, never derived — reclustering must not reshuffle
 * a trip the user curated by hand.
 */
export interface TripRecord {
  id: string;
  name: string;
  /** User renamed it; auto-naming (phase 2) must never overwrite. */
  nameIsCustom: boolean;
  createdAt: number;
  /** Travel dates, set by reservation extraction (phase 2); display falls back to member mail dates. */
  startDate?: number;
  endDate?: number;
}

/**
 * Assigns one message to a trip. Keyed by Message-ID (see pinKeyOf) so the
 * assignment survives archive moves and id renumbering. tripId null is a
 * tombstone: the user removed the message from all trips, and the phase-2
 * auto-clusterer must not add it back. Manual rows always win over auto rows.
 */
export interface TripMembershipRecord {
  key: string;
  tripId: string | null;
  source: "auto" | "manual";
  addedAt: number;
}

export interface SnoozeRecord {
  messageId: number;
  wakeAt: number;
  originFolderId: string;
  originAccountId: string;
  /** Identifies the message across the archive move (which changes its numeric id). */
  headerMessageId?: string;
}

/**
 * A pinned message. Keyed by Message-ID header (see pinKeyOf) so the pin
 * follows the message across folder moves and numeric-id changes.
 */
export interface PinRecord {
  key: string;
  pinnedAt: number;
}

export interface FolderCursorRecord {
  folderId: string;
  /** Newest message date (ms) seen in this folder; incremental scans query from here minus an overlap. */
  maxDate: number;
  /** When the last full scan of this folder completed (ms); 0 = never. */
  fullScanAt: number;
}

export interface TranslationRecord {
  id: string;
  messageId: number;
  bodyHash: string;
  provider: string;
  sourceLanguage: string | null;
  targetLanguage: string;
  bodyType?: "text" | "html";
  translatedSubject?: string;
  translatedText: string;
  createdAt: number;
}

export interface Delta {
  added?: RawMessage[];
  updated?: RawMessage[];
  removedIds?: number[];
}

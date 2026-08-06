// No "travel": travel mail is either in a trip (its own layer, see TripRecord)
// or loose in the inbox, exactly as in Google Inbox. The classifier's travel
// heuristic survives as a trip-candidacy predicate only — see matchesTravel.
export type BuiltinCategory =
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
  /**
   * CLASSIFIER_VERSION in force when `category` was decided. Scans reuse a
   * cached category rather than re-running the pipeline, so without this stamp
   * a rules change would never reach mail that is already cached. Rows below
   * the current version are re-classified by the version sweep. Absent on
   * sent/draft rows, which are never classified.
   */
  classifierVersion?: number;
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
 * Why a message joined its trip. The clusterer knows this at join time and it
 * is the only place the knowledge exists — recomputing it later would mean
 * re-running the whole clustering pass — so it is persisted alongside the
 * membership and surfaced in the UI ("why is this in my trip?").
 */
export type TripMembershipReasonKind =
  /** Seeded the trip: a flight/lodging/train/rental reservation was extracted. */
  | "reservation"
  /** Shares a confirmation code with the trip. */
  | "code-match"
  /** Its dates fall within CLUSTER_GAP of a member's. */
  | "date-range"
  /** A separately booked flight home from somewhere the trip visited. */
  | "return-leg"
  /** The user put it there by hand. */
  | "manual";

export interface TripMembershipReason {
  kind: TripMembershipReasonKind;
  /** Short human detail: the shared code, the matched leg, the reservation. */
  detail?: string;
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
  /** Absent on rows written before reasons were recorded. */
  reason?: TripMembershipReason;
}

export type ReservationKind =
  | "flight"
  | "lodging"
  | "train"
  | "rental"
  | "dining"
  | "event"
  | "other";

/** One leg / stay / booking inside a reservation email. */
export interface ReservationSegment {
  kind: ReservationKind;
  /** Departure / check-in (ms). Day precision is all clustering needs. */
  start: number;
  /** Arrival / check-out (ms); omitted when the email only gives one date. */
  end?: number;
  /** IATA code or station for flights/trains; city or venue text otherwise. */
  origin?: string;
  destination?: string;
  /** Human line: "UA 837 SFO → NRT", "Hyatt Regency Tokyo". */
  summary?: string;
}

/**
 * The reservation-extraction result for one message, keyed by Message-ID
 * (pinKeyOf) like trip memberships. Negative results are stored too
 * (status "none") so the sweep never refetches a body it already scanned;
 * bumping EXTRACTOR_VERSION invalidates everything for re-extraction.
 */
export interface ReservationRecord {
  key: string;
  messageDate: number;
  senderDomain: string;
  extractorVersion: number;
  /** Extractor id that produced the hit, or "" for status "none". */
  extractor: string;
  status: "extracted" | "cancelled" | "none";
  segments: ReservationSegment[];
  /**
   * Confirmation codes / record locators found near context words
   * ("confirmation #", "record locator", …). Populated even when no
   * reservation was extracted — that's how check-in reminders and receipts
   * get matched to the trip that owns the code (phase 3).
   */
  confirmationCodes: string[];
  scannedAt: number;
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

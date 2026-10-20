import type { MessageKey } from "./messageKey";

// "travel" is only used with trips turned off (see tripsSetting.ts). With
// trips on, travel mail is in a trip (its own layer, see TripRecord) or files
// under Updates, exactly as in Google Inbox.
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
  /** Stable identity (account, folder, Message-ID); see messageKey.ts. */
  key: MessageKey;
  /**
   * Thunderbird's numeric id as last seen. Session-scoped and dropped by
   * moves, so it is only a hint: resolve it with liveTbId before calling any
   * messenger.messages API.
   */
  tbId: number;
  headerMessageId: string;
  subject: string;
  author: string;
  recipients: string[];
  ccList: string[];
  bccList: string[];
  date: number;
  resurfacedAt?: number;
  /** The snooze ran its course (not unsnoozed by hand); rows then say "Snoozed … ago". */
  snoozeExpired?: boolean;
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
  /**
   * The opening of the message's own text, shown grey after the subject in
   * the list. Filled in with the other details from the same body fetch.
   */
  snippet?: string;
  /**
   * Shipments the message lets you track (inbox rows only), shown as cards
   * on its row. Filled in with the other details; absent when there are none.
   */
  parcels?: Parcel[];
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
  /** The snooze ran its course (not unsnoozed by hand); rows then say "Snoozed … ago". */
  snoozeExpired?: boolean;
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
  /**
   * The account the reminder belongs to: the one shown when it was created,
   * or the default account if that was every account. Unset only when there
   * was no account at all; it then shows in every account.
   */
  accountId?: string;
  /** When a snoozed reminder returns to the inbox; unset = not snoozed. */
  snoozeWakeAt?: number;
  /** Set when the reminder's stream position comes from a snooze wake. */
  resurfacedAt?: number;
  /** The snooze ran its course (not unsnoozed by hand); rows then say "Snoozed … ago". */
  snoozeExpired?: boolean;
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

/** Who carries a parcel; "unknown" when the mail never says. */
export type Carrier =
  | "ups"
  | "usps"
  | "fedex"
  | "dhl"
  | "ontrac"
  | "yamato"
  | "sagawa"
  | "japanpost"
  | "amazon"
  | "yodobashi"
  | "unknown";

/** A shipment an email lets you track. NeoInbox never tracks its state. */
export interface Parcel {
  carrier: Carrier;
  /** Absent when the mail only links the shop's own tracking page (Amazon). */
  number?: string;
  /** Where TRACK goes: the carrier's lookup page, else the mail's own link. */
  url?: string;
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
  /**
   * Body fetches that failed so far (offline, or IMAP hasn't synced it). Set
   * only on a placeholder "none" record; sweeps retry until it reaches
   * MAX_FETCH_FAILURES, then leave the message alone.
   */
  fetchFailures?: number;
}

export interface SnoozeRecord {
  /**
   * The snoozed inbox row's key. The row keeps it while the message is parked
   * in the archive, so Snoozed and the wake both find it by this.
   */
  messageKey: MessageKey;
  wakeAt: number;
  originFolderId: string;
  originAccountId: string;
  headerMessageId: string;
  /**
   * Where snoozing parked the message, so the wake is a direct lookup rather
   * than paging the archive (on Gmail, All Mail). The id is a hint like
   * RawMessage.tbId — verified by Message-ID, and useless after a restart —
   * so the wake falls back to a search of the recorded folder, then of the
   * account's archive folders.
   */
  archivedTbId?: number;
  archivedFolderId?: string;
}

/**
 * A pinned message. Keyed by Message-ID header (see pinKeyOf) so the pin
 * follows the message across folder moves and numeric-id changes.
 */
export interface PinRecord {
  key: string;
  pinnedAt: number;
}

/**
 * A message's stream position after a snooze wake, keyed like pins so it
 * survives Thunderbird renumbering the message after the move back to the
 * inbox (an IMAP move hands out a placeholder id, then the real UID).
 */
export interface ResurfacedRecord {
  key: string;
  resurfacedAt: number;
  snoozeExpired: boolean;
}

export interface FolderCursorRecord {
  folderId: string;
  /** Newest message date (ms) seen in this folder; incremental scans query from here minus an overlap. */
  maxDate: number;
  /** When the last full scan of this folder completed (ms); 0 = never. */
  fullScanAt: number;
  /**
   * Inbox only: how far the folder's message count ran ahead of its cached
   * rows at the last full scan or inbox import — mail outside the scan
   * window, and duplicate copies sharing one row. The drift check adds it
   * back, or such an inbox would read as drifted on every sync.
   */
  countGap?: number;
}

export interface TranslationRecord {
  id: string;
  messageKey: MessageKey;
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
  removedKeys?: MessageKey[];
}

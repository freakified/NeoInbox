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
  pinned: boolean;
  origin: MessageOrigin;
  references?: string[];
  inReplyTo?: string[];
  attachments?: AttachmentSummary[];
  detailsVersion?: number;
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
}

export interface SnoozeRecord {
  messageId: number;
  wakeAt: number;
  originFolderId: string;
  originAccountId: string;
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

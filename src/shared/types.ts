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

export interface CustomBundleRule {
  type: "domain" | "email" | "subject_keyword";
  value: string;
}

export interface CustomBundleRecord {
  id: string;
  name: string;
  color: string;
  icon: string;
  order: number;
  rules: CustomBundleRule[];
}

export interface BundleRuleRecord {
  id: string;
  category: BuiltinCategory;
  rule: CustomBundleRule;
  createdAt: number;
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
  date: number;
  size: number;
  read: boolean;
  folderId: string;
  accountId: string;
  tags: string[];
  category: Category | null;
  pinned: boolean;
  origin: "inbox" | "sent";
  references?: string[];
  inReplyTo?: string[];
  attachments?: AttachmentSummary[];
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
}

export interface SnoozeRecord {
  messageId: number;
  wakeAt: number;
  originFolderId: string;
  originAccountId: string;
}

export interface OverrideRecord {
  senderDomain: string;
  category: BuiltinCategory;
}

export interface FolderCursorRecord {
  folderId: string;
  lastMessageId: number;
  done: boolean;
}

export interface Delta {
  added?: RawMessage[];
  updated?: RawMessage[];
  removedIds?: number[];
}

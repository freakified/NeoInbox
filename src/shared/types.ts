export type Category =
  | "travel"
  | "finance"
  | "purchases"
  | "social"
  | "updates"
  | "promos"
  | "forums"
  | "personal";

export interface RawMessage {
  id: number;
  subject: string;
  author: string;
  recipients: string[];
  date: number;
  read: boolean;
  folderId: string;
  accountId: string;
  tags: string[];
  category: Category | null;
  pinned: boolean;
  origin: "inbox" | "sent";
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
  category: Category;
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

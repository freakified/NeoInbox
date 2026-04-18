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
  id: string;                 // `${accountId}:${normalizedSubject}`
  subject: string;            // latest message's subject (original, with Re:/Fwd:)
  messages: RawMessage[];     // sorted by date ascending (oldest first)
  participantsLabel: string;  // e.g. "Steve, me"
  latestDate: number;
  unreadCount: number;
  pinned: boolean;
  category: Category | null;
  accountId: string;
  hasMe: boolean;             // true if any message was sent by me
}

export interface SnoozeRecord {
  messageId: number;
  wakeAt: number;
}

export interface Bundle {
  id: string;
  category: Category;
  messageIds: number[];
  tripLabel?: string;
}

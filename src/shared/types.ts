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
  date: number;
  read: boolean;
  folderId: string;
  accountId: string;
  tags: string[];
  category: Category | null;
  pinned: boolean;
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

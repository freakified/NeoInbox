/**
 * A cached message's identity: the copy of a Message-ID in one folder.
 *
 * Thunderbird's numeric message ids can't be this. Its docs: "an internal
 * tracking number that does not remain after a restart. Nor does it follow an
 * email that has been moved to a different folder." Keying the cache by them
 * let a new session's id 57 overwrite an archived row cached as 57 in an
 * earlier one — the message just vanished. The numeric id survives as
 * RawMessage.tbId, a hint verified before every use (see liveMessage.ts).
 *
 * The folder is part of the key because one Message-ID routinely has several
 * copies (Gmail's Inbox and All Mail, Sent and All Mail), and threading and
 * Done need them as separate rows. A move therefore re-keys the row.
 */
export type MessageKey = string;

interface KeyParts {
  accountId: string;
  folderId: string;
  headerMessageId: string;
  date: number;
  author: string;
  subject: string;
}

export const messageKeyOf = (m: KeyParts): MessageKey => {
  // Thunderbird synthesizes a Message-ID for mail that lacks one, so this
  // fallback is for the odd header that still comes back empty.
  const id = m.headerMessageId || `~${m.date}|${m.author}|${m.subject}`;
  return `${m.accountId}|${m.folderId}|${id}`;
};

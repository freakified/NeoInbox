import { log } from "./log";

type Header = messenger.messages.MessageHeader & { folder?: { id?: string } };

/**
 * The Thunderbird id to use for a cached row right now. Row ids are hints
 * (RawMessage.tbId): Thunderbird renumbers on restart and on moves, and a
 * stale id silently refers to a completely different message, so anything
 * that fetches bodies or acts on a message must come through here.
 *
 * Returns the hint when it still checks out by Message-ID, a re-resolved id
 * when it had gone stale, or null when the message can no longer be found.
 */
export const liveTbId = async (m: {
  tbId: number;
  headerMessageId: string;
  folderId?: string;
  accountId?: string;
}): Promise<number | null> => {
  try {
    const header = await messenger.messages.get(m.tbId);
    // Rows without a Message-ID can't be verified or re-resolved; trust the id.
    if (!m.headerMessageId || header.headerMessageId === m.headerMessageId) {
      return m.tbId;
    }
    log.debug("live-message", "cached id points at a different message", {
      tbId: m.tbId,
      cached: m.headerMessageId,
      found: header.headerMessageId,
    });
  } catch {
    if (!m.headerMessageId) return null;
    /* id no longer resolves; fall through to the Message-ID lookup */
  }
  // Try the folder we last saw it in before widening. Most drift is a
  // re-indexing within the same folder, and a folder-scoped query is a single
  // indexed lookup — where the account-wide one below walks every folder,
  // including the big ones nothing else here ever touches.
  if (m.folderId) {
    try {
      const page = (await messenger.messages.query({
        headerMessageId: m.headerMessageId,
        folderId: m.folderId as unknown as messenger.folders.MailFolderId,
      } as unknown as Parameters<typeof messenger.messages.query>[0])) as {
        messages?: Header[];
      };
      const found = page.messages?.[0];
      if (found) return found.id;
    } catch (e) {
      log.debug("live-message", "folder-scoped lookup failed; widening", {
        tbId: m.tbId,
        e: String(e),
      });
    }
  }
  try {
    // Scope to the account: an unscoped query walks every folder of every
    // account and can take seconds on a large mailbox.
    const page = (await messenger.messages.query({
      headerMessageId: m.headerMessageId,
      ...(m.accountId ? { accountId: m.accountId } : {}),
    } as unknown as Parameters<typeof messenger.messages.query>[0])) as {
      messages?: Header[];
    };
    const matches = page.messages ?? [];
    const sameFolder = matches.find((h) => h.folder?.id === m.folderId);
    return (sameFolder ?? matches[0])?.id ?? null;
  } catch (e) {
    log.warn("live-message", "Message-ID lookup failed", { tbId: m.tbId, e: String(e) });
    return null;
  }
}

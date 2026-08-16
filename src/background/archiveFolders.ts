import { log } from "../shared/log";

type FolderRef = { id?: string; accountId?: string };
type HeaderWithFolder = messenger.messages.MessageHeader & {
  folder?: FolderRef;
  headerMessageId?: string;
};

export const walkFolders = (
  folders: messenger.folders.MailFolder[],
  visit: (f: messenger.folders.MailFolder) => void,
): void => {
  for (const f of folders) {
    visit(f);
    if (f.subFolders) walkFolders(f.subFolders, visit);
  }
}

export const archiveFolderIdsForAccount = async (
  accountId: string,
): Promise<string[]> => {
  const accounts = await messenger.accounts.list();
  const out: string[] = [];
  for (const acc of accounts) {
    if (accountId && acc.id !== accountId) continue;
    walkFolders(acc.folders ?? [], (f) => {
      if (!f.id) return;
      if (
        f.specialUse?.includes("archives") ||
        (f as unknown as { type?: string }).type === "archives"
      ) {
        out.push(f.id);
      }
    });
  }
  return out;
}

export interface ResolvedArchive {
  archiveFolderId: string;
  sourceFolderId: string;
  accountId: string;
}

export const resolveArchiveFolder = async (
  messageId: number,
): Promise<ResolvedArchive | null> => {
  const msg = (await messenger.messages.get(messageId)) as HeaderWithFolder;
  const sourceFolderId = msg.folder?.id ?? "";
  const accountId = msg.folder?.accountId ?? "";
  if (!accountId) return null;
  const candidates = await archiveFolderIdsForAccount(accountId);
  const archiveFolderId = candidates.find((id) => id !== sourceFolderId);
  if (!archiveFolderId) return null;
  return { archiveFolderId, sourceFolderId, accountId };
}

export const messageStillIn = async (
  messageId: number,
  folderId: string,
): Promise<boolean> => {
  if (!folderId) return false;
  try {
    const fresh = (await messenger.messages.get(messageId)) as HeaderWithFolder;
    return fresh.folder?.id === folderId;
  } catch {
    return false;
  }
}

/**
 * One message in one folder, by Message-ID.
 *
 * This used to page `messages.list()` over the folder and compare headers by
 * hand, which is the single most expensive shape in the codebase: enumerating
 * a folder makes Thunderbird sync that folder's headers, and the folder this
 * gets pointed at is usually the archive — on a Gmail account, All Mail. A
 * folder-scoped query is one indexed lookup and never enumerates anything.
 */
export const findByHeaderMessageIdInFolder = async (
  folderId: string,
  headerMessageId: string,
): Promise<messenger.messages.MessageHeader | undefined> => {
  if (!folderId || !headerMessageId) return undefined;
  try {
    const page = (await messenger.messages.query({
      folderId: folderId as unknown as messenger.folders.MailFolderId,
      headerMessageId,
    } as unknown as Parameters<typeof messenger.messages.query>[0])) as {
      messages?: messenger.messages.MessageHeader[];
    };
    return page.messages?.[0];
  } catch (e) {
    log.warn("archive-folders", "folder-scoped Message-ID lookup failed", {
      folderId,
      e: String(e),
    });
    return undefined;
  }
}

export const messageStillInFolderByHeader = async (
  folderId: string,
  headerMessageId: string,
): Promise<boolean> => {
  return !!(await findByHeaderMessageIdInFolder(folderId, headerMessageId));
}

export interface ArchivedCopy {
  id: number;
  folderId: string;
}

/**
 * Where a message ended up after being archived.
 *
 * Callers record this so they never have to go looking in the archive again —
 * a snooze wake becomes a `messages.get` on a known id rather than a search.
 * The account-wide fallback exists because Thunderbird's archive settings can
 * file mail into a dated subfolder (`Archives/2026`) that doesn't itself carry
 * the `archives` special-use flag, so the folder-scoped pass would miss it.
 */
export const locateArchivedCopy = async (
  accountId: string,
  sourceFolderId: string,
  headerMessageId: string,
): Promise<ArchivedCopy | null> => {
  if (!headerMessageId) return null;

  for (const folderId of await archiveFolderIdsForAccount(accountId)) {
    if (folderId === sourceFolderId) continue;
    const found = await findByHeaderMessageIdInFolder(folderId, headerMessageId);
    if (found) return { id: found.id, folderId };
  }

  try {
    const page = (await messenger.messages.query({
      headerMessageId,
      ...(accountId ? { accountId } : {}),
    } as unknown as Parameters<typeof messenger.messages.query>[0])) as {
      messages?: HeaderWithFolder[];
    };
    const elsewhere = (page.messages ?? []).find(
      (h) => h.folder?.id && h.folder.id !== sourceFolderId,
    );
    if (elsewhere?.folder?.id) {
      return { id: elsewhere.id, folderId: elsewhere.folder.id };
    }
  } catch (e) {
    log.warn("archive-folders", "locating the archived copy failed", {
      headerMessageId,
      e: String(e),
    });
  }
  return null;
}

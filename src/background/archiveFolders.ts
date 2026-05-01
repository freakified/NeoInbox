type FolderRef = { id?: string; accountId?: string };
type HeaderWithFolder = messenger.messages.MessageHeader & {
  folder?: FolderRef;
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

export interface InboxFolder {
  id: string;
  name: string;
  accountId: string;
}

export const collectInboxFolders = async (): Promise<InboxFolder[]> => {
  return collectFolders(isInbox);
}

export const collectSentFolders = async (): Promise<InboxFolder[]> => {
  return collectFolders(isSent);
}

export const collectArchiveFolders = async (): Promise<InboxFolder[]> => {
  return collectFolders(isArchive);
}

const collectFolders = async (
  match: (f: messenger.folders.MailFolder) => boolean,
): Promise<InboxFolder[]> => {
  const accounts = await messenger.accounts.list();
  const out: InboxFolder[] = [];
  for (const acc of accounts) {
    walk(acc.folders ?? [], (f) => {
      if (!f.id) return;
      if (!match(f)) return;
      out.push({
        id: f.id,
        name: f.name ?? f.path,
        accountId: f.accountId ?? acc.id,
      });
    });
  }
  return out;
}

const isInbox = (f: messenger.folders.MailFolder): boolean => {
  if (f.specialUse?.includes("inbox")) return true;
  if (f.type === "inbox") return true;
  return false;
}

const isSent = (f: messenger.folders.MailFolder): boolean => {
  if (f.specialUse?.includes("sent")) return true;
  if (f.type === "sent") return true;
  return false;
}

const isArchive = (f: messenger.folders.MailFolder): boolean => {
  if (f.specialUse?.includes("archives")) return true;
  if (f.type === "archives") return true;
  return false;
}

const walk = (
  folders: messenger.folders.MailFolder[],
  visit: (f: messenger.folders.MailFolder) => void,
): void => {
  for (const f of folders) {
    visit(f);
    if (f.subFolders) walk(f.subFolders, visit);
  }
};

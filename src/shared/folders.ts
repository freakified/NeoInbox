export interface InboxFolder {
  id: string;
  name: string;
  accountId: string;
}

interface FolderRoles {
  inbox: InboxFolder[];
  sent: InboxFolder[];
  drafts: InboxFolder[];
  archives: InboxFolder[];
  junk: InboxFolder[];
}

/** TTL is a safety net for missed folder events; events invalidate eagerly. */
const CACHE_TTL_MS = 5 * 60_000;

let cache: { roles: FolderRoles; at: number } | null = null;
let pending: Promise<FolderRoles> | null = null;

export const invalidateFolderCache = (): void => {
  cache = null;
};

export const collectInboxFolders = async (): Promise<InboxFolder[]> => {
  return (await getRoles()).inbox;
}

export const collectSentFolders = async (): Promise<InboxFolder[]> => {
  return (await getRoles()).sent;
}

export const collectDraftFolders = async (): Promise<InboxFolder[]> => {
  return (await getRoles()).drafts;
}

export const collectArchiveFolders = async (): Promise<InboxFolder[]> => {
  return (await getRoles()).archives;
}

export const collectJunkFolders = async (): Promise<InboxFolder[]> => {
  return (await getRoles()).junk;
}

const getRoles = async (): Promise<FolderRoles> => {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.roles;
  pending ??= loadRoles()
    .then((roles) => {
      cache = { roles, at: Date.now() };
      return roles;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

const loadRoles = async (): Promise<FolderRoles> => {
  const accounts = await messenger.accounts.list();
  const roles: FolderRoles = { inbox: [], sent: [], drafts: [], archives: [], junk: [] };
  for (const acc of accounts) {
    walk(acc.folders ?? [], (f, underArchive) => {
      if (!f.id) return;
      const entry: InboxFolder = {
        id: f.id,
        name: f.name ?? f.path,
        accountId: f.accountId ?? acc.id,
      };
      if (isInbox(f)) roles.inbox.push(entry);
      if (isSent(f)) roles.sent.push(entry);
      if (isDraft(f)) roles.drafts.push(entry);
      if (underArchive || isArchive(f)) roles.archives.push(entry);
      if (isJunk(f)) roles.junk.push(entry);
    });
  }
  return roles;
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

const isDraft = (f: messenger.folders.MailFolder): boolean => {
  if (f.specialUse?.includes("drafts")) return true;
  if (f.type === "drafts") return true;
  return false;
}

const isJunk = (f: messenger.folders.MailFolder): boolean => {
  if (f.specialUse?.includes("junk")) return true;
  if (f.type === "junk") return true;
  return false;
}

const isArchive = (f: messenger.folders.MailFolder): boolean => {
  if (f.specialUse?.includes("archives")) return true;
  if (f.type === "archives") return true;
  return false;
}

/**
 * Visits every folder, telling `visit` whether it sits inside an archive
 * folder: Thunderbird's archive settings file mail into dated subfolders
 * (`Archives/2026`) that don't carry the `archives` flag themselves.
 */
const walk = (
  folders: messenger.folders.MailFolder[],
  visit: (f: messenger.folders.MailFolder, underArchive: boolean) => void,
  underArchive = false,
): void => {
  for (const f of folders) {
    visit(f, underArchive);
    if (f.subFolders) walk(f.subFolders, visit, underArchive || isArchive(f));
  }
};

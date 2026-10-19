import { log } from "../../shared/log";

type FolderRole = "inbox" | "trash" | "junk" | "archives";

const findFolder = (
  folders: messenger.folders.MailFolder[],
  role: FolderRole,
): messenger.folders.MailFolder | null => {
  for (const f of folders) {
    if (f.id && (f.specialUse?.includes(role) || f.type === role)) return f;
    const nested = findFolder(f.subFolders ?? [], role);
    if (nested) return nested;
  }
  return null;
};

/**
 * The folder for a role in `accountId`, else the default account's, else the
 * first account that has one.
 */
const folderForRole = async (
  role: FolderRole,
  accountId?: string | null,
): Promise<messenger.folders.MailFolder | null> => {
  const [accounts, defaultAccount] = await Promise.all([
    messenger.accounts.list(true),
    messenger.accounts.getDefault?.(false).catch(() => null) ?? Promise.resolve(null),
  ]);
  const rank = (id: string) => (id === accountId ? 2 : id === defaultAccount?.id ? 1 : 0);
  const ordered = [...accounts].sort((a, b) => rank(b.id) - rank(a.id));
  for (const account of ordered) {
    const folder = findFolder(account.folders ?? [], role);
    if (folder) return folder;
  }
  return null;
};

/**
 * Shows a folder in Thunderbird's own mail view: reuses an existing 3-pane
 * tab rather than piling up new ones each click. Returns that tab's id.
 */
const showFolder = async (
  roles: readonly FolderRole[],
  accountId?: string | null,
): Promise<number | null> => {
  let folder: messenger.folders.MailFolder | null = null;
  for (const role of roles) {
    folder = await folderForRole(role, accountId);
    if (folder?.id) break;
  }
  if (!folder?.id) {
    log.warn("tb-views", `No ${roles.join("/")} folder found in any account`);
    return null;
  }
  const [mailTab] = await messenger.mailTabs.query({});
  if (mailTab) {
    await messenger.mailTabs.update(mailTab.id, { displayedFolder: folder.id });
    await messenger.tabs.update(mailTab.id, { active: true });
    // Window mode keeps the main window minimized; bring it back up.
    const mainWindow = await messenger.windows.get(mailTab.windowId);
    await messenger.windows.update(mailTab.windowId, {
      focused: true,
      ...(mainWindow.state === "minimized" ? { state: "normal" as const } : {}),
    });
    return mailTab.id;
  }
  return (await messenger.mailTabs.create({ displayedFolder: folder.id })).id;
};

export const openThunderbirdFolder = async (role: FolderRole): Promise<void> => {
  try {
    await showFolder([role]);
  } catch (err) {
    log.warn("tb-views", `Opening ${role} folder in Thunderbird failed`, err);
  }
};

/**
 * Hands a search to Thunderbird: the account's archive in a mail tab (Gmail's
 * All Mail, which holds nearly everything), narrowed by the Quick Filter bar
 * to sender, recipients, subject and body. The WebExtension API has no handle
 * on Thunderbird's global search, and the filter bar works on one folder, so
 * this is the widest search of its own it can open. Accounts without an
 * archive folder get their Inbox.
 */
export const searchInThunderbird = async (query: string, accountId?: string | null): Promise<void> => {
  const text = query.trim();
  if (!text) return;
  try {
    const tabId = await showFolder(["archives", "inbox"], accountId);
    if (tabId === null) return;
    await messenger.mailTabs.setQuickFilter(tabId, {
      show: true,
      text: { text, author: true, recipients: true, subject: true, body: true },
    });
  } catch (err) {
    log.warn("tb-views", "Searching in Thunderbird failed", err);
  }
};

export const openThunderbirdContacts = async (): Promise<void> => {
  try {
    await messenger.addressBooks.openUI();
  } catch (err) {
    log.warn("tb-views", "Opening the Thunderbird address book failed", err);
  }
};

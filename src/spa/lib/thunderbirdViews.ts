import { log } from "../../shared/log";

type FolderRole = "inbox" | "trash" | "junk";

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

/** The default account's folder for a role, else the first account that has one. */
const folderForRole = async (role: FolderRole): Promise<messenger.folders.MailFolder | null> => {
  const [accounts, defaultAccount] = await Promise.all([
    messenger.accounts.list(true),
    messenger.accounts.getDefault?.(false).catch(() => null) ?? Promise.resolve(null),
  ]);
  const ordered = defaultAccount
    ? [...accounts].sort((a, b) => Number(b.id === defaultAccount.id) - Number(a.id === defaultAccount.id))
    : accounts;
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
const showFolder = async (role: FolderRole): Promise<number | null> => {
  const folder = await folderForRole(role);
  if (!folder?.id) {
    log.warn("tb-views", `No ${role} folder found in any account`);
    return null;
  }
  const [mailTab] = await messenger.mailTabs.query({});
  if (mailTab) {
    await messenger.mailTabs.update(mailTab.id, { displayedFolder: folder.id });
    await messenger.tabs.update(mailTab.id, { active: true });
    await messenger.windows.update(mailTab.windowId, { focused: true });
    return mailTab.id;
  }
  return (await messenger.mailTabs.create({ displayedFolder: folder.id })).id;
};

export const openThunderbirdFolder = async (role: FolderRole): Promise<void> => {
  try {
    await showFolder(role);
  } catch (err) {
    log.warn("tb-views", `Opening ${role} folder in Thunderbird failed`, err);
  }
};

/**
 * Hands a search to Thunderbird: the Inbox in a mail tab, narrowed by the
 * Quick Filter bar to sender, recipients and subject. The WebExtension API has
 * no handle on Thunderbird's global search box, so this is the closest search
 * of its own it can open; the filter bar it leaves showing can widen the
 * match to message bodies.
 */
export const searchInThunderbird = async (query: string): Promise<void> => {
  const text = query.trim();
  if (!text) return;
  try {
    const tabId = await showFolder("inbox");
    if (tabId === null) return;
    await messenger.mailTabs.setQuickFilter(tabId, {
      show: true,
      text: { text, author: true, recipients: true, subject: true },
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

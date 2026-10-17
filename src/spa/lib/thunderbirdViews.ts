import { log } from "../../shared/log";

type FolderRole = "trash" | "junk";

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
 * tab rather than piling up new ones each click.
 */
export const openThunderbirdFolder = async (role: FolderRole): Promise<void> => {
  try {
    const folder = await folderForRole(role);
    if (!folder?.id) {
      log.warn("tb-views", `No ${role} folder found in any account`);
      return;
    }
    const [mailTab] = await messenger.mailTabs.query({});
    if (mailTab) {
      await messenger.mailTabs.update(mailTab.id, { displayedFolder: folder.id });
      await messenger.tabs.update(mailTab.id, { active: true });
      await messenger.windows.update(mailTab.windowId, { focused: true });
    } else {
      await messenger.mailTabs.create({ displayedFolder: folder.id });
    }
  } catch (err) {
    log.warn("tb-views", `Opening ${role} folder in Thunderbird failed`, err);
  }
};

export const openThunderbirdContacts = async (): Promise<void> => {
  try {
    await messenger.addressBooks.openUI();
  } catch (err) {
    log.warn("tb-views", "Opening the Thunderbird address book failed", err);
  }
};

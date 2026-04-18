export interface InboxFolder {
  id: string;
  name: string;
  accountId: string;
}

export async function collectInboxFolders(): Promise<InboxFolder[]> {
  const accounts = await messenger.accounts.list();
  const out: InboxFolder[] = [];
  for (const acc of accounts) {
    walk(acc.folders ?? [], (f) => {
      if (!f.id) return;
      if (!isInbox(f)) return;
      out.push({
        id: f.id,
        name: f.name ?? f.path,
        accountId: f.accountId ?? acc.id,
      });
    });
  }
  return out;
}

function isInbox(f: messenger.folders.MailFolder): boolean {
  if (f.specialUse?.includes("inbox")) return true;
  if (f.type === "inbox") return true;
  return false;
}

function walk(
  folders: messenger.folders.MailFolder[],
  visit: (f: messenger.folders.MailFolder) => void,
): void {
  for (const f of folders) {
    visit(f);
    if (f.subFolders) walk(f.subFolders, visit);
  }
}

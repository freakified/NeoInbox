export interface InboxFolder {
  id: string;
  name: string;
  accountId: string;
}

export async function collectInboxFolders(): Promise<InboxFolder[]> {
  return collectFolders(isInbox);
}

export async function collectSentFolders(): Promise<InboxFolder[]> {
  return collectFolders(isSent);
}

async function collectFolders(
  match: (f: messenger.folders.MailFolder) => boolean,
): Promise<InboxFolder[]> {
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

function isInbox(f: messenger.folders.MailFolder): boolean {
  if (f.specialUse?.includes("inbox")) return true;
  if (f.type === "inbox") return true;
  return false;
}

function isSent(f: messenger.folders.MailFolder): boolean {
  if (f.specialUse?.includes("sent")) return true;
  if (f.type === "sent") return true;
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

import { useEffect, useState } from "react";
import { collectInboxFolders } from "../../shared/folders";
import { log } from "../../shared/log";

/** A Thunderbird account NeoInbox shows mail from: one with an inbox. */
export interface MailAccount {
  id: string;
  name: string;
  /** The account's default identity, for labelling it. */
  email: string;
  /** That identity's "Your Name", which the account name often isn't. */
  ownerName: string;
  color: string;
}

/** Assigned by account order, so each account keeps its color across reloads. */
const ACCOUNT_COLORS = [
  "#4285F4",
  "#0F9D58",
  "#DB4437",
  "#F4B400",
  "#AB47BC",
  "#00ACC1",
  "#FF7043",
  "#5C6BC0",
];

type BareAccount = Omit<MailAccount, "color">;

let cached: Promise<BareAccount[]> | null = null;

/**
 * Accounts in Thunderbird's order, minus the ones with no inbox (Local
 * Folders, feeds), which never contribute mail to the stream.
 */
const loadAccounts = async (): Promise<BareAccount[]> => {
  const [accounts, inboxes] = await Promise.all([
    messenger.accounts.list(false),
    collectInboxFolders(),
  ]);
  const withInbox = new Set(inboxes.map((f) => f.accountId));
  return accounts
    .filter((account) => withInbox.has(account.id))
    .map((account) => ({
      id: account.id,
      name: account.name,
      email: account.identities?.[0]?.email ?? "",
      ownerName: account.identities?.[0]?.name?.trim() ?? "",
    }));
};

const colored = (accounts: BareAccount[]): MailAccount[] =>
  accounts.map((account, i) => ({ ...account, color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]! }));

/** Accounts load once per tab, like identities; changes show up on reload. */
export const listAccounts = (): Promise<BareAccount[]> =>
  (cached ??= loadAccounts().catch((e) => {
    log.warn("accounts", "couldn't list accounts", e);
    cached = null;
    return [];
  }));

export const useAccounts = (): MailAccount[] => {
  const [accounts, setAccounts] = useState<BareAccount[]>([]);
  useEffect(() => {
    let cancelled = false;
    void listAccounts().then((list) => {
      if (!cancelled) setAccounts(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return colored(accounts);
};

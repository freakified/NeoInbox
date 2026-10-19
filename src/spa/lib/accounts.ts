import { useEffect, useState } from "react";
import { collectInboxFolders } from "../../shared/folders";
import { log } from "../../shared/log";
import { useMailStore } from "../../store/mailStore";

/** A Thunderbird account NeoInbox shows mail from: one with an inbox. */
export interface MailAccount {
  id: string;
  name: string;
  /** The account's default identity, for labelling it. */
  email: string;
  color: string;
}

const COLORS_KEY = "neoinbox.accountColors";

/** Assigned by account order, so each account keeps its color across reloads. */
export const ACCOUNT_COLORS = [
  "#4285F4",
  "#0F9D58",
  "#DB4437",
  "#F4B400",
  "#AB47BC",
  "#00ACC1",
  "#FF7043",
  "#5C6BC0",
];

const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};

const readColors = (): Record<string, string> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(COLORS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
};

export const setAccountColor = (accountId: string, color: string): void => {
  try {
    localStorage.setItem(COLORS_KEY, JSON.stringify({ ...readColors(), [accountId]: color }));
  } catch {
    // Unwritable storage: the color just won't stick.
  }
  changed();
};

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
    }));
};

const colored = (accounts: BareAccount[]): MailAccount[] => {
  const colors = readColors();
  return accounts.map((account, i) => ({
    ...account,
    color: colors[account.id] ?? ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]!,
  }));
};

/** Accounts load once per tab, like identities; changes show up on reload. */
export const useAccounts = (): MailAccount[] => {
  const [accounts, setAccounts] = useState<BareAccount[]>([]);
  const [, setColorVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    cached ??= loadAccounts().catch((e) => {
      log.warn("accounts", "couldn't list accounts", e);
      cached = null;
      return [];
    });
    void cached.then((list) => {
      if (!cancelled) setAccounts(list);
    });
    const onChange = () => setColorVersion((v) => v + 1);
    listeners.add(onChange);
    return () => {
      cancelled = true;
      listeners.delete(onChange);
    };
  }, []);
  return colored(accounts);
};

/**
 * The account to label an open conversation with: only in the all-accounts
 * view, and only when there is more than one account to tell apart.
 */
export const useAccountMarker = (accountId: string): MailAccount | null => {
  const accounts = useAccounts();
  const accountFilter = useMailStore((st) => st.accountFilter);
  if (accounts.length < 2 || accountFilter) return null;
  return accounts.find((a) => a.id === accountId) ?? null;
};

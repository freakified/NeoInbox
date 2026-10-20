import { useSyncExternalStore } from "react";

const DEFAULT_ACCOUNT_KEY = "neoinbox.defaultAccount";
const UNIFIED_INBOX_KEY = "neoinbox.unifiedInbox";

/** The default account value that opens on every account together. */
export const UNIFIED = "unified";

const listeners = new Set<() => void>();

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key) || null;
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null): void => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // The choice just won't survive a reload.
  }
};

/** The account NeoInbox opens on, or UNIFIED; null means the first account. */
export const getDefaultAccount = (): string | null => read(DEFAULT_ACCOUNT_KEY);

export const setDefaultAccount = (accountId: string | null): void => write(DEFAULT_ACCOUNT_KEY, accountId);

/** Whether all accounts can be shown together. Off by default. */
export const getUnifiedInbox = (): boolean => read(UNIFIED_INBOX_KEY) === "1";

export const setUnifiedInbox = (enabled: boolean): void => {
  write(UNIFIED_INBOX_KEY, enabled ? "1" : null);
  for (const listener of listeners) listener();
};

export const useUnifiedInbox = (): boolean =>
  useSyncExternalStore((onChange) => {
    listeners.add(onChange);
    return () => listeners.delete(onChange);
  }, getUnifiedInbox);

/**
 * The default account as it applies to these accounts: a remembered account
 * that's since left Thunderbird, or the unified inbox once it's turned off,
 * falls back to the first account.
 */
export const effectiveDefaultAccount = (
  accounts: readonly { id: string }[],
  stored: string | null,
  unified: boolean,
): string | null => {
  if (stored === UNIFIED && unified) return UNIFIED;
  if (accounts.some((a) => a.id === stored)) return stored;
  return accounts[0]?.id ?? null;
};

/**
 * The account filter to open on: null shows every account, which with a
 * single account is just that account.
 */
export const startingAccountFilter = (accounts: readonly { id: string }[]): string | null => {
  if (accounts.length < 2) return null;
  const choice = effectiveDefaultAccount(accounts, getDefaultAccount(), getUnifiedInbox());
  return choice === UNIFIED ? null : choice;
};

const DEFAULT_ACCOUNT_KEY = "neoinbox.defaultAccount";

/** The account NeoInbox opens on; null opens on every account together. */
export const getDefaultAccount = (): string | null => {
  try {
    return localStorage.getItem(DEFAULT_ACCOUNT_KEY) || null;
  } catch {
    return null;
  }
};

export const setDefaultAccount = (accountId: string | null): void => {
  try {
    if (accountId) localStorage.setItem(DEFAULT_ACCOUNT_KEY, accountId);
    else localStorage.removeItem(DEFAULT_ACCOUNT_KEY);
  } catch {
    // The choice just won't survive a reload.
  }
};

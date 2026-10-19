import { useEffect, useState } from "react";
import type { ComposeIdentity } from "../../shared/compose";
import { log } from "../../shared/log";

let cached: Promise<ComposeIdentity[]> | null = null;

/**
 * Every send-from identity in Thunderbird: the default account's first, each
 * account's default identity first within it (the order pickIdentity needs).
 */
const loadIdentities = async (): Promise<ComposeIdentity[]> => {
  const [accounts, defaultAccount] = await Promise.all([
    messenger.accounts.list(false),
    messenger.accounts.getDefault?.(false).catch(() => null) ?? Promise.resolve(null),
  ]);
  const ordered = defaultAccount
    ? [...accounts].sort((a, b) => Number(b.id === defaultAccount.id) - Number(a.id === defaultAccount.id))
    : accounts;
  return ordered.flatMap((account) =>
    (account.identities ?? []).flatMap((identity) =>
      identity.id && identity.email
        ? [{ id: identity.id, accountId: account.id, email: identity.email, name: identity.name ?? "" }]
        : [],
    ),
  );
};

/** Identities load once per tab; changes in Thunderbird show up on reload. */
export const listIdentities = (): Promise<ComposeIdentity[]> =>
  (cached ??= loadIdentities().catch((e) => {
    log.warn("identities", "couldn't list identities", e);
    cached = null;
    return [];
  }));

export const useIdentities = (): ComposeIdentity[] => {
  const [identities, setIdentities] = useState<ComposeIdentity[]>([]);
  useEffect(() => {
    let cancelled = false;
    void listIdentities().then((list) => {
      if (!cancelled) setIdentities(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return identities;
};

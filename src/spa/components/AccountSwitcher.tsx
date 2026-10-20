import { clsx } from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMailStore } from "../../store/mailStore";
import { startingAccountFilter, useUnifiedInbox } from "../lib/accountPrefs";
import { type MailAccount, useAccounts } from "../lib/accounts";
import { useSelfProfile } from "../lib/contactCards";
import { openNewIssue } from "../lib/external";
import { useAnchoredMenu } from "../lib/useAnchoredMenu";
import { Icon } from "./Icon";
import { ContactPhoto } from "./ContactPhoto";
import s from "./AccountSwitcher.module.css";

/**
 * Who an account belongs to, for its avatar: your name and photo from the
 * identity and your own address-book card. Thunderbird names mail accounts
 * after their address by default, so the account name only labels the
 * account when you've given it one of your own ("Work").
 */
export const useAccountPerson = (account: MailAccount | null) => {
  const profile = useSelfProfile(account?.email);
  if (!account) return null;
  const isAddress = !account.name || account.name.toLowerCase() === account.email.toLowerCase();
  const person = account.ownerName || profile.name;
  return {
    label: isAddress ? person || account.email : account.name,
    initial: (person || account.name || account.email).charAt(0).toUpperCase() || "?",
    photo: profile.photo,
  };
};

export const AccountAvatar = ({
  account,
  person,
  className,
}: {
  account: MailAccount;
  person: NonNullable<ReturnType<typeof useAccountPerson>>;
  className: string | undefined;
}) => (
  <span className={className} style={{ backgroundColor: account.color }}>
    <ContactPhoto address={account.email} self>{person.initial}</ContactPhoto>
  </span>
);

/**
 * Google-style avatar menu in the app bar: settings, help, and with more than
 * one account, switching between them, or to all of them together once the
 * unified inbox is turned on.
 */
export const AccountSwitcher = ({
  onShowShortcuts,
  onShowAbout,
}: {
  onShowShortcuts: () => void;
  onShowAbout: () => void;
}) => {
  const accounts = useAccounts();
  const unified = useUnifiedInbox();
  const accountFilter = useMailStore((st) => st.accountFilter);
  const setAccountFilter = useMailStore((st) => st.setAccountFilter);
  const messagesByKey = useMailStore((st) => st.messagesByKey);
  const openBundleSettings = useMailStore((st) => st.openBundleSettings);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuStyle = useAnchoredMenu(open, triggerRef, menuRef);

  const multiple = accounts.length > 1;
  const filtered = accounts.find((a) => a.id === accountFilter) ?? null;
  // With one account there's nothing to switch between: it is the account.
  const current = multiple ? filtered : accounts[0] ?? null;
  const currentPerson = useAccountPerson(current);

  // An account that's since been removed from Thunderbird would otherwise
  // leave every view empty with no way to tell why, and the unified inbox
  // can be turned off while it's showing.
  const stranded = multiple && !filtered && (accountFilter !== null || !unified);
  useEffect(() => {
    if (stranded) setAccountFilter(startingAccountFilter(accounts));
  }, [stranded, accounts, setAccountFilter]);

  // Everything in each inbox, read or not; snoozed mail is out until it wakes.
  const inboxCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!open) return counts;
    for (const m of Object.values(messagesByKey)) {
      if (m.origin !== "inbox" || m.snoozed) continue;
      counts.set(m.accountId, (counts.get(m.accountId) ?? 0) + 1);
    }
    return counts;
  }, [open, messagesByKey]);
  const totalInbox = [...inboxCounts.values()].reduce((sum, n) => sum + n, 0);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const choose = (accountId: string | null) => {
    setOpen(false);
    setAccountFilter(accountId);
  };

  const label = !current || !currentPerson
    ? multiple ? "Unified inbox" : "your account"
    : current.email && current.email !== currentPerson.label
      ? `${currentPerson.label} (${current.email})`
      : currentPerson.label;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={s.trigger}
        title={multiple ? `Showing ${label}` : label}
        aria-label={multiple ? `Accounts and settings, showing ${label}` : "Account and settings"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {current && currentPerson ? (
          <AccountAvatar account={current} person={currentPerson} className={s.avatar} />
        ) : (
          <span className={clsx(s.avatar, s.allAvatar)}>
            <Icon name={multiple ? "all_inbox" : "person"} className={s.allIcon} />
          </span>
        )}
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className={s.menu}
          style={menuStyle}
          role="menu"
          aria-label="Accounts"
          onClick={(e) => e.stopPropagation()}
        >
          {multiple && unified && (
            <>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!current}
                className={clsx(s.item, !current && s.itemActive)}
                onClick={() => choose(null)}
              >
                <span className={clsx(s.itemAvatar, s.allAvatarLight)}>
                  <Icon name="all_inbox" className={s.allIconSmall} />
                </span>
                <span className={s.itemText}>
                  <span className={s.itemName}>Unified inbox</span>
                  <span className={s.itemEmail}>All accounts together</span>
                </span>
                {totalInbox > 0 && <span className={s.count}>{totalInbox}</span>}
              </button>
              <div className={s.divider} />
            </>
          )}
          {accounts.map((account) => (
            <AccountItem
              key={account.id}
              account={account}
              active={current?.id === account.id}
              count={multiple ? inboxCounts.get(account.id) ?? 0 : 0}
              onChoose={multiple ? () => choose(account.id) : undefined}
            />
          ))}
          {accounts.length > 0 && <div className={s.divider} />}
          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => {
              setOpen(false);
              openBundleSettings({});
            }}
          >
            <Icon name="settings" className={s.footerIcon} />
            <span className={s.itemName}>Settings</span>
          </button>
          <div className={s.divider} />
          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => {
              setOpen(false);
              void openNewIssue("bug");
            }}
          >
            <Icon name="bug_report" className={s.footerIcon} />
            <span className={s.itemName}>Report a bug</span>
            <Icon name="open_in_new" className={s.externalIcon} />
          </button>
          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => {
              setOpen(false);
              void openNewIssue("feature");
            }}
          >
            <Icon name="lightbulb" className={s.footerIcon} />
            <span className={s.itemName}>Request a feature</span>
            <Icon name="open_in_new" className={s.externalIcon} />
          </button>
          <div className={s.divider} />
          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => {
              setOpen(false);
              onShowShortcuts();
            }}
          >
            <Icon name="keyboard" className={s.footerIcon} />
            <span className={s.itemName}>Keyboard shortcuts</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={s.item}
            onClick={() => {
              setOpen(false);
              onShowAbout();
            }}
          >
            <Icon name="info" className={s.footerIcon} />
            <span className={s.itemName}>About NeoInbox</span>
          </button>
        </div>,
        document.body,
      )}
    </>
  );
};

/** An account to switch to, or with `onChoose` absent, just who you are. */
const AccountItem = ({
  account,
  active,
  count,
  onChoose,
}: {
  account: MailAccount;
  active: boolean;
  count: number;
  onChoose?: () => void;
}) => {
  const person = useAccountPerson(account)!;
  const content = (
    <>
      <AccountAvatar account={account} person={person} className={s.itemAvatar} />
      <span className={s.itemText}>
        <span className={s.itemName}>{person.label}</span>
        {account.email && account.email !== person.label && (
          <span className={s.itemEmail}>{account.email}</span>
        )}
      </span>
      {count > 0 && <span className={s.count}>{count}</span>}
    </>
  );
  if (!onChoose) return <div className={clsx(s.item, s.itemStatic)}>{content}</div>;
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      className={clsx(s.item, active && s.itemActive)}
      onClick={onChoose}
    >
      {content}
    </button>
  );
};

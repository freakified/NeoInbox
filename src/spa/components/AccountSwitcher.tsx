import { clsx } from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMailStore } from "../../store/mailStore";
import { type MailAccount, useAccounts } from "../lib/accounts";
import { useAnchoredMenu } from "../lib/useAnchoredMenu";
import { Icon } from "./Icon";
import s from "./AccountSwitcher.module.css";

const initialOf = (account: MailAccount): string =>
  (account.name || account.email).charAt(0).toUpperCase() || "?";

/**
 * Google-style avatar menu in the app bar: settings, keyboard shortcuts, and
 * with more than one account, narrowing every view to one account's mail or
 * showing them all.
 */
export const AccountSwitcher = ({ onShowShortcuts }: { onShowShortcuts: () => void }) => {
  const accounts = useAccounts();
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

  // A remembered account that's since been removed from Thunderbird would
  // otherwise leave every view empty with no way to tell why.
  useEffect(() => {
    if (accounts.length && accountFilter && !filtered) setAccountFilter(null);
  }, [accounts, accountFilter, filtered, setAccountFilter]);

  const unread = useMemo(() => {
    const counts = new Map<string, number>();
    if (!open) return counts;
    for (const m of Object.values(messagesByKey)) {
      if (m.origin !== "inbox" || m.snoozed || m.read) continue;
      counts.set(m.accountId, (counts.get(m.accountId) ?? 0) + 1);
    }
    return counts;
  }, [open, messagesByKey]);
  const totalUnread = [...unread.values()].reduce((sum, n) => sum + n, 0);

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

  const label = !multiple
    ? current?.email || current?.name || "your account"
    : current
      ? `${current.name} (${current.email})`
      : "All accounts";

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
        {current ? (
          <span className={s.avatar} style={{ backgroundColor: current.color }}>
            {initialOf(current)}
          </span>
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
          {multiple && (
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
                  <span className={s.itemName}>All accounts</span>
                  <span className={s.itemEmail}>Every inbox together</span>
                </span>
                {totalUnread > 0 && <span className={s.count}>{totalUnread}</span>}
              </button>
              <div className={s.divider} />
            </>
          )}
          {accounts.map((account) => {
            const active = current?.id === account.id;
            const count = unread.get(account.id) ?? 0;
            return (
              <button
                key={account.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={clsx(s.item, multiple && active && s.itemActive)}
                onClick={() => choose(multiple ? account.id : null)}
              >
                <span className={s.itemAvatar} style={{ backgroundColor: account.color }}>
                  {initialOf(account)}
                </span>
                <span className={s.itemText}>
                  <span className={s.itemName}>{account.name}</span>
                  {account.email && account.email !== account.name && (
                    <span className={s.itemEmail}>{account.email}</span>
                  )}
                </span>
                {multiple && count > 0 && <span className={s.count}>{count}</span>}
              </button>
            );
          })}
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
            <span className={s.count}>?</span>
          </button>
        </div>,
        document.body,
      )}
    </>
  );
};

import { clsx } from "clsx";
import { UNIFIED } from "../../lib/accountPrefs";
import type { MailAccount } from "../../lib/accounts";
import { AccountAvatar, useAccountPerson } from "../AccountSwitcher";
import { Icon } from "../Icon";
import s from "../BundleManagerModal.module.css";
import menu from "../AccountSwitcher.module.css";

export interface AccountSettings {
  unified: boolean;
  /** An account id or UNIFIED, already resolved against the accounts. */
  defaultAccount: string | null;
}

/** The unified inbox and which account NeoInbox opens on; only worth asking with more than one. */
export const DefaultAccountSection = ({
  accounts,
  value,
  onChange,
}: {
  accounts: MailAccount[];
  value: AccountSettings;
  onChange: (next: AccountSettings) => void;
}) => (
  <>
    <section className={s.section}>
      <h4 className={s.sectionTitle}>Unified Inbox</h4>
      <div className={s.policyChoices}>
        <label className={clsx(s.policyChoice, s.twoLineChoice)}>
          <input
            type="checkbox"
            checked={value.unified}
            onChange={(e) => {
              const unified = e.target.checked;
              // Turning it off can't leave the unified inbox as the default.
              const fallback = value.defaultAccount === UNIFIED ? accounts[0]?.id ?? null : value.defaultAccount;
              onChange({ unified, defaultAccount: unified ? value.defaultAccount : fallback });
            }}
            className={s.checkInput}
          />
          <span className={menu.itemText}>
            <span className={menu.itemName}>Enable unified inbox</span>
            <span className={menu.itemEmail}>Shows every account's mail together</span>
          </span>
        </label>
      </div>
    </section>
    <section className={s.section}>
      <h4 className={s.sectionTitle}>Default account</h4>
      <p className={s.helpText}>What NeoInbox shows when it opens. Switch any time from the avatar menu at the top right.</p>
      <div className={s.policyChoices}>
        {value.unified && (
          <label className={clsx(s.policyChoice, s.twoLineChoice)}>
            <input
              type="radio"
              name="default-account"
              checked={value.defaultAccount === UNIFIED}
              onChange={() => onChange({ ...value, defaultAccount: UNIFIED })}
              className={s.policyInput}
            />
            <span className={clsx(menu.itemAvatar, menu.allAvatarLight)}>
              <Icon name="all_inbox" className={menu.allIconSmall} />
            </span>
            <span className={menu.itemText}>
              <span className={menu.itemName}>Unified inbox</span>
              <span className={menu.itemEmail}>All accounts together</span>
            </span>
          </label>
        )}
        {accounts.map((account) => (
          <DefaultChoice
            key={account.id}
            account={account}
            checked={value.defaultAccount === account.id}
            onChange={() => onChange({ ...value, defaultAccount: account.id })}
          />
        ))}
      </div>
    </section>
  </>
);

const DefaultChoice = ({
  account,
  checked,
  onChange,
}: {
  account: MailAccount;
  checked: boolean;
  onChange: () => void;
}) => {
  const person = useAccountPerson(account)!;
  return (
    <label className={clsx(s.policyChoice, s.twoLineChoice)}>
      <input
        type="radio"
        name="default-account"
        checked={checked}
        onChange={onChange}
        className={s.policyInput}
      />
      <AccountAvatar account={account} person={person} className={menu.itemAvatar} />
      <span className={menu.itemText}>
        <span className={menu.itemName}>{person.label}</span>
        {account.email && account.email !== person.label && (
          <span className={menu.itemEmail}>{account.email}</span>
        )}
      </span>
    </label>
  );
};

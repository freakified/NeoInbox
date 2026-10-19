import { clsx } from "clsx";
import { useState } from "react";
import { ACCOUNT_COLORS, setAccountColor, useAccounts } from "../../lib/accounts";
import { getDefaultAccount, setDefaultAccount } from "../../lib/accountPrefs";
import { Icon } from "../Icon";
import s from "../BundleManagerModal.module.css";

export const AccountSettings = () => {
  const accounts = useAccounts();
  const [defaultAccount, setDefault] = useState(getDefaultAccount);
  // A default that's since left Thunderbird opens on every account.
  const effectiveDefault = accounts.some((a) => a.id === defaultAccount) ? defaultAccount : null;

  const chooseDefault = (accountId: string | null) => {
    setDefaultAccount(accountId);
    setDefault(accountId);
  };

  return (
    <div className={s.editor}>
      <div className={s.editorHeader}>
        <Icon name="manage_accounts" className={s.editorIcon} />
        <h3 className={s.editorTitle}>Accounts</h3>
      </div>
      <section className={s.section}>
        <h4 className={s.sectionTitle}>Default account</h4>
        <p className={s.helpText}>What NeoInbox shows when it opens. Switch any time from the avatar menu at the top right.</p>
        <div className={s.policyChoices}>
          <DefaultChoice
            checked={!effectiveDefault}
            label="All accounts"
            onChange={() => chooseDefault(null)}
          />
          {accounts.map((account) => (
            <DefaultChoice
              key={account.id}
              checked={effectiveDefault === account.id}
              label={account.email && account.email !== account.name ? `${account.name} (${account.email})` : account.name}
              onChange={() => chooseDefault(account.id)}
            />
          ))}
        </div>
      </section>
      <section className={s.section}>
        <h4 className={s.sectionTitle}>Account colors</h4>
        <p className={s.helpText}>
          Marks which account an open conversation is in, when all accounts are shown together.
        </p>
        {accounts.map((account) => (
          <div key={account.id} className={s.fieldBlock}>
            <p className={s.accountLabel}>{account.email || account.name}</p>
            <div className={s.colorGrid} role="radiogroup" aria-label={`Color for ${account.name}`}>
              {ACCOUNT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={account.color === color}
                  className={clsx(s.colorSwatch, account.color === color && s.colorSwatchActive)}
                  style={{ backgroundColor: color }}
                  onClick={() => setAccountColor(account.id, color)}
                  title={color}
                />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
};

const DefaultChoice = ({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) => (
  <label className={s.policyChoice}>
    <input
      type="radio"
      name="default-account"
      checked={checked}
      onChange={onChange}
      className={s.policyInput}
    />
    <span>{label}</span>
  </label>
);

import { useEffect, useState } from "react";
import {
  effectiveDefaultAccount,
  getDefaultAccount,
  getUnifiedInbox,
  setDefaultAccount,
  setUnifiedInbox,
} from "../../lib/accountPrefs";
import { listAccounts, useAccounts } from "../../lib/accounts";
import { Icon } from "../Icon";
import { type AccountSettings, DefaultAccountSection } from "./DefaultAccountSettings";
import { OpenModeSection } from "./OpenModeSettings";
import s from "../BundleManagerModal.module.css";

export const GeneralSettings = () => {
  const accounts = useAccounts();
  const [account, setAccount] = useState<AccountSettings | null>(null);

  // Waits for the accounts, so the default is resolved against them.
  useEffect(() => {
    void listAccounts().then((accountList) => {
      const unified = getUnifiedInbox();
      setAccount({ unified, defaultAccount: effectiveDefaultAccount(accountList, getDefaultAccount(), unified) });
    });
  }, []);

  const changeAccount = (next: AccountSettings) => {
    setUnifiedInbox(next.unified);
    setDefaultAccount(next.defaultAccount);
    setAccount(next);
  };

  return (
    <div className={s.editor}>
      <div className={s.editorHeader}>
        <Icon name="settings" className={s.editorIcon} />
        <h3 className={s.editorTitle}>General</h3>
      </div>
      <OpenModeSection />
      {account && accounts.length > 1 && (
        <DefaultAccountSection accounts={accounts} value={account} onChange={changeAccount} />
      )}
    </div>
  );
};

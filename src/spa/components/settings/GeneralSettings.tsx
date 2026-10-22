import { useEffect, useState } from "react";
import { useMailStore } from "../../../store/mailStore";
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
import { loadOpenSettings, OpenModeSection, type OpenSettings, saveOpenSettings } from "./OpenModeSettings";
import s from "../BundleManagerModal.module.css";

type GeneralForm = OpenSettings & AccountSettings;

export const GeneralSettings = () => {
  const notify = useMailStore((st) => st.notify);
  const closeSettings = useMailStore((st) => st.closeBundleSettings);
  const accounts = useAccounts();
  const [saved, setSaved] = useState<GeneralForm | null>(null);
  const [draft, setDraft] = useState<GeneralForm | null>(null);

  // Waits for the accounts, so the default is resolved against them.
  useEffect(() => {
    void Promise.all([loadOpenSettings(), listAccounts()]).then(([open, accountList]) => {
      const unified = getUnifiedInbox();
      const defaultAccount = effectiveDefaultAccount(accountList, getDefaultAccount(), unified);
      const form = { ...open, unified, defaultAccount };
      setSaved(form);
      setDraft(form);
    });
  }, []);

  if (!saved || !draft) {
    return (
      <div className={s.editor}>
        <Header />
      </div>
    );
  }

  const hasChanges = (Object.keys(draft) as (keyof GeneralForm)[]).some((k) => draft[k] !== saved[k]);

  const save = () => {
    // Account choices first: they save synchronously, and a mode change
    // closes this page.
    setUnifiedInbox(draft.unified);
    setDefaultAccount(draft.defaultAccount);
    void saveOpenSettings(saved, draft)
      .then(() => {
        notify("Settings saved");
        closeSettings();
      })
      .catch(() => notify("Couldn't save that setting"));
  };

  return (
    <div className={s.editor}>
      <Header />
      <OpenModeSection value={draft} onChange={(open) => setDraft({ ...draft, ...open })} />
      {accounts.length > 1 && (
        <DefaultAccountSection
          accounts={accounts}
          value={draft}
          onChange={(account) => setDraft({ ...draft, ...account })}
        />
      )}
      <div className={s.formActions}>
        <button type="button" className={s.saveBtn} disabled={!hasChanges} onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
};

const Header = () => (
  <div className={s.editorHeader}>
    <Icon name="settings" className={s.editorIcon} />
    <h3 className={s.editorTitle}>General</h3>
  </div>
);

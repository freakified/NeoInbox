import { useEffect, useState } from "react";
import { useMailStore } from "../../../store/mailStore";
import {
  getOpenMode,
  getOpenOnStartup,
  type OpenMode,
  setOpenMode,
  setOpenOnStartup,
} from "../../../shared/openMode";
import { Icon } from "../Icon";
import s from "../BundleManagerModal.module.css";

const MODES: Record<OpenMode, { icon: string; status: string; switchLabel: string }> = {
  tab: { icon: "tab", status: "In a Thunderbird tab", switchLabel: "Move to its own window" },
  window: { icon: "select_window", status: "In its own window", switchLabel: "Move to a Thunderbird tab" },
};

/**
 * Startup applies on change. The mode is a button, not a choice to save:
 * switching makes the background move NeoInbox, closing this page.
 */
export const OpenModeSection = () => {
  const notify = useMailStore((st) => st.notify);
  const [mode, setMode] = useState<OpenMode | null>(null);
  const [onStartup, setOnStartup] = useState<boolean | null>(null);

  useEffect(() => {
    void Promise.all([getOpenMode(), getOpenOnStartup()]).then(([m, startup]) => {
      setMode(m);
      setOnStartup(startup);
    });
  }, []);

  if (mode === null || onStartup === null) return null;

  const switchMode = () => {
    void setOpenMode(mode === "tab" ? "window" : "tab").catch(() =>
      notify("Couldn't move NeoInbox"),
    );
  };

  const changeStartup = (next: boolean) => {
    setOnStartup(next);
    void setOpenOnStartup(next).catch(() => {
      setOnStartup(!next);
      notify("Couldn't save that setting");
    });
  };

  return (
    <section className={s.section}>
      <h4 className={s.sectionTitle}>Open NeoInbox</h4>
      <div className={s.status}>
        <Icon name={MODES[mode].icon} className={s.statusIcon} />
        <span>{MODES[mode].status}</span>
        <button type="button" className={s.statusAction} onClick={switchMode}>
          {MODES[mode].switchLabel}
        </button>
      </div>
      <div className={s.policyChoices}>
        <label className={s.policyChoice}>
          <input
            type="checkbox"
            checked={onStartup}
            onChange={(e) => changeStartup(e.target.checked)}
            className={s.checkInput}
          />
          <span>Automatically open NeoInbox when Thunderbird starts</span>
        </label>
      </div>
    </section>
  );
};

import { useEffect, useState } from "react";
import { useMailStore } from "../../../store/mailStore";
import {
  getOpenMode,
  getOpenOnStartup,
  type OpenMode,
  setOpenMode,
  setOpenOnStartup,
} from "../../../shared/openMode";
import s from "../BundleManagerModal.module.css";

const CHOICES: { mode: OpenMode; label: string }[] = [
  { mode: "tab", label: "In a Thunderbird tab" },
  { mode: "window", label: "In its own window" },
];

export const OpenModeSection = () => {
  const notify = useMailStore((st) => st.notify);
  const [mode, setMode] = useState<OpenMode | null>(null);
  const [onStartup, setOnStartup] = useState<boolean | null>(null);

  useEffect(() => {
    void getOpenMode().then(setMode);
    void getOpenOnStartup().then(setOnStartup);
  }, []);

  const choose = (next: OpenMode) => {
    setMode(next);
    void setOpenMode(next).then(() =>
      notify("Takes effect next time NeoInbox opens from the toolbar or Thunderbird starts"),
    );
  };

  const toggleStartup = (next: boolean) => {
    setOnStartup(next);
    void setOpenOnStartup(next);
  };

  return (
    <section className={s.section}>
      <h4 className={s.sectionTitle}>Open NeoInbox</h4>
      <div className={s.policyChoices}>
        {CHOICES.map((c) => (
          <label className={s.policyChoice} key={c.mode}>
            <input
              type="radio"
              name="open-mode"
              checked={mode === c.mode}
              onChange={() => choose(c.mode)}
              className={s.policyInput}
            />
            <span>{c.label}</span>
          </label>
        ))}
        <label className={s.policyChoice}>
          <input
            type="checkbox"
            checked={onStartup === true}
            onChange={(e) => toggleStartup(e.target.checked)}
            className={s.checkInput}
          />
          <span>Open when Thunderbird starts</span>
        </label>
      </div>
    </section>
  );
};

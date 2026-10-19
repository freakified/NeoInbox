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

interface OpenSettings {
  mode: OpenMode;
  onStartup: boolean;
}

export const OpenModeSection = () => {
  const notify = useMailStore((st) => st.notify);
  const [saved, setSaved] = useState<OpenSettings | null>(null);
  const [draft, setDraft] = useState<OpenSettings | null>(null);

  useEffect(() => {
    void Promise.all([getOpenMode(), getOpenOnStartup()]).then(([mode, onStartup]) => {
      setSaved({ mode, onStartup });
      setDraft({ mode, onStartup });
    });
  }, []);

  const hasChanges =
    !!saved && !!draft && (saved.mode !== draft.mode || saved.onStartup !== draft.onStartup);

  const save = () => {
    if (!draft) return;
    // Startup first: a mode change makes the background move NeoInbox,
    // closing this page.
    void setOpenOnStartup(draft.onStartup)
      .then(() => setOpenMode(draft.mode))
      .then(() => {
        setSaved(draft);
        notify("Settings saved");
      })
      .catch(() => notify("Couldn't save that setting"));
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
              checked={draft?.mode === c.mode}
              onChange={() => setDraft((d) => d && { ...d, mode: c.mode })}
              className={s.policyInput}
            />
            <span>{c.label}</span>
          </label>
        ))}
        <label className={s.policyChoice}>
          <input
            type="checkbox"
            checked={draft?.onStartup === true}
            onChange={(e) => {
              const onStartup = e.target.checked;
              setDraft((d) => d && { ...d, onStartup });
            }}
            className={s.checkInput}
          />
          <span>Automatically open NeoInbox when Thunderbird starts</span>
        </label>
      </div>
      <div className={s.formActions}>
        <button type="button" className={s.saveBtn} disabled={!hasChanges} onClick={save}>
          Save
        </button>
      </div>
    </section>
  );
};

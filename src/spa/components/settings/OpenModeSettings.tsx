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

export interface OpenSettings {
  mode: OpenMode;
  onStartup: boolean;
}

export const loadOpenSettings = async (): Promise<OpenSettings> => {
  const [mode, onStartup] = await Promise.all([getOpenMode(), getOpenOnStartup()]);
  return { mode, onStartup };
};

/** Startup first: a mode change makes the background move NeoInbox, closing this page. */
export const saveOpenSettings = async (saved: OpenSettings, draft: OpenSettings): Promise<void> => {
  if (saved.onStartup !== draft.onStartup) await setOpenOnStartup(draft.onStartup);
  if (saved.mode !== draft.mode) await setOpenMode(draft.mode);
};

export const OpenModeSection = ({
  value,
  onChange,
}: {
  value: OpenSettings;
  onChange: (next: OpenSettings) => void;
}) => (
  <section className={s.section}>
    <h4 className={s.sectionTitle}>Open NeoInbox</h4>
    <div className={s.policyChoices}>
      {CHOICES.map((c) => (
        <label className={s.policyChoice} key={c.mode}>
          <input
            type="radio"
            name="open-mode"
            checked={value.mode === c.mode}
            onChange={() => onChange({ ...value, mode: c.mode })}
            className={s.policyInput}
          />
          <span>{c.label}</span>
        </label>
      ))}
      <label className={s.policyChoice}>
        <input
          type="checkbox"
          checked={value.onStartup}
          onChange={(e) => onChange({ ...value, onStartup: e.target.checked })}
          className={s.checkInput}
        />
        <span>Automatically open NeoInbox when Thunderbird starts</span>
      </label>
    </div>
  </section>
);

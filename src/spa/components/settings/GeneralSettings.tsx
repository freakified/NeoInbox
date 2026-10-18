import { setComposeMode, useComposeMode, type ComposeMode } from "../../lib/composePrefs";
import { useMailStore } from "../../../store/mailStore";
import { setShowDeleteActions, useShowDeleteActions } from "../../lib/deleteActionPrefs";
import {
  setSnoozePrefs,
  TIME_OF_DAY_LABELS,
  TIMES_OF_DAY,
  useSnoozePrefs,
} from "../../lib/snoozePrefs";
import { Icon } from "../Icon";
import s from "../BundleManagerModal.module.css";

const COMPOSE_MODE_CHOICES: { mode: ComposeMode; label: string }[] = [
  { mode: "send", label: "Write inline and send from NeoInbox" },
  { mode: "review", label: "Write inline, then finish and send in Thunderbird" },
  { mode: "thunderbird", label: "Always use Thunderbird's compose window" },
];

const toTimeValue = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const dayName = (day: number): string =>
  // 2026-02-01 is a Sunday.
  new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date(2026, 1, 1 + day));

const SnoozeSettings = () => {
  const prefs = useSnoozePrefs();
  return (
    <section className={s.section}>
      <h4 className={s.sectionTitle}>Snooze</h4>
      {TIMES_OF_DAY.map((t) => (
        <label key={t} className={s.twoColumn} style={{ alignItems: "center" }}>
          <span>{TIME_OF_DAY_LABELS[t]}</span>
          <input
            type="time"
            className={s.input}
            value={toTimeValue(prefs.times[t])}
            onChange={(e) => {
              const [h, m] = e.currentTarget.value.split(":").map(Number);
              if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return;
              setSnoozePrefs({ ...prefs, times: { ...prefs.times, [t]: h * 60 + m } });
            }}
          />
        </label>
      ))}
      <label className={s.twoColumn} style={{ alignItems: "center" }}>
        <span>Weekend</span>
        <select
          className={s.select}
          value={prefs.weekendStart}
          onChange={(e) => setSnoozePrefs({ ...prefs, weekendStart: Number(e.currentTarget.value) })}
        >
          {Array.from({ length: 7 }, (_, day) => (
            <option key={day} value={day}>
              {dayName(day)} – {dayName((day + 1) % 7)}
            </option>
          ))}
        </select>
      </label>
      <p className={s.helpText}>
        Snooze presets use these times: “Tomorrow” and the weekday presets wake
        in the morning, “Later today” in the evening. “This weekend” wakes on
        the first weekend day, and “Next week” on the day after the weekend.
      </p>
    </section>
  );
};

export const GeneralSettings = () => {
  const reclassify = useMailStore((st) => st.reclassify);
  const reclassifying = useMailStore((st) => st.reclassifying);
  const showDeleteActions = useShowDeleteActions();
  const composeMode = useComposeMode();
  return (
    <div className={s.editor}>
      <div className={s.editorHeader}>
        <Icon name="settings" className={s.editorIcon} />
        <div>
          <h3 className={s.editorTitle}>General</h3>
          <p className={s.editorDesc}>Configure app-wide behavior.</p>
        </div>
      </div>
      <section className={s.section}>
        <h4 className={s.sectionTitle}>Actions</h4>
        <label className={s.policyChoice}>
          <input
            type="checkbox"
            checked={showDeleteActions}
            onChange={(e) => setShowDeleteActions(e.target.checked)}
            className={s.policyInput}
          />
          <span>Show delete actions in the mail stream</span>
        </label>
        <p className={s.helpText}>
          Adds Trash to row hover actions and “Delete all” sweeps to sections
          and bundles. Leave it off for the faithful Google Inbox experience —
          pin, snooze, and done only. Moving a single conversation to trash
          stays available inside the opened conversation either way.
        </p>
      </section>
      <SnoozeSettings />
      <section className={s.section}>
        <h4 className={s.sectionTitle}>Compose</h4>
        {COMPOSE_MODE_CHOICES.map((choice) => (
          <label key={choice.mode} className={s.policyChoice}>
            <input
              type="radio"
              name="compose-mode"
              checked={composeMode === choice.mode}
              onChange={() => setComposeMode(choice.mode)}
              className={s.policyInput}
            />
            <span>{choice.label}</span>
          </label>
        ))}
        <p className={s.helpText}>
          Thunderbird has no way for add-ons to send mail invisibly, so sending
          from NeoInbox briefly opens a Thunderbird compose window, which closes
          itself once the message is sent. Thunderbird still handles your
          identity, signature, quoting, and the Sent folder.
        </p>
      </section>
      <section className={s.section}>
        <h4 className={s.sectionTitle}>Bundling</h4>
        <p className={s.helpText}>
          Rules are applied as mail arrives, so messages bundled before a rule
          change can be left in the wrong place. Re-run all rules and built-in
          detection across the inbox to fix them.
        </p>
        <button
          type="button"
          className={s.primaryBtn}
          disabled={reclassifying}
          onClick={() => reclassify()}
        >
          {reclassifying ? "Reclassifying…" : "Reclassify inbox"}
        </button>
      </section>
    </div>
  );
};

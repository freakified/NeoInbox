import { setComposeMode, useComposeMode, type ComposeMode } from "../../lib/composePrefs";
import { useMailStore } from "../../../store/mailStore";
import { setShowDeleteActions, useShowDeleteActions } from "../../lib/deleteActionPrefs";
import { Icon } from "../Icon";
import s from "../BundleManagerModal.module.css";

const COMPOSE_MODE_CHOICES: { mode: ComposeMode; label: string }[] = [
  { mode: "send", label: "Write inline and send from NeoInbox" },
  { mode: "review", label: "Write inline, then finish and send in Thunderbird" },
  { mode: "thunderbird", label: "Always use Thunderbird's compose window" },
];

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

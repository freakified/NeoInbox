import { clsx } from "clsx";
import { useMailStore } from "../../../store/mailStore";
import { Icon } from "../Icon";
import { TRIP_COLOR } from "../TripSliceRow";
import s from "../BundleManagerModal.module.css";

const MODES: { enabled: boolean; label: string; hint: string }[] = [
  {
    enabled: true,
    label: "Trip Bundles",
    hint: "Automatically group related travel emails into trips, extracting relevant information into convenient cards (Inbox behavior 2015-2019)",
  },
  {
    enabled: false,
    label: "Travel Bundle",
    hint: "A standard bundle for Travel-related emails. (Inbox behavior 2014-2015)",
  },
];

/**
 * The one trips setting. Shown on the Trips pane, and on the Travel bundle
 * that replaces it in the other mode, so it can be switched back from the
 * same spot.
 */
export const TripsToggle = ({ onChange }: { onChange: (enabled: boolean) => void }) => {
  const tripsEnabled = useMailStore((st) => st.tripsEnabled);
  const setTripsEnabled = useMailStore((st) => st.setTripsEnabled);
  return (
    <section className={s.section}>
      <h4 className={s.sectionTitle}>Mode</h4>
      <div className={s.policyChoices}>
        {MODES.map((mode) => (
          <label className={clsx(s.policyChoice, s.twoLineChoice)} key={mode.label}>
            <input
              type="radio"
              name="trips-mode"
              checked={tripsEnabled === mode.enabled}
              onChange={() => {
                setTripsEnabled(mode.enabled);
                onChange(mode.enabled);
              }}
              className={s.policyInput}
            />
            <span className={s.choiceText}>
              <span>{mode.label}</span>
              <span className={s.choiceHint}>{mode.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
};

/** Trips have no rules to edit; this pane says how they're found. */
export const TripSettings = ({ onToggle }: { onToggle: (enabled: boolean) => void }) => (
  <div className={s.editor}>
    <div className={s.editorHeader}>
      <Icon name="travel" className={s.editorIcon} style={{ color: TRIP_COLOR }} />
      <div>
        <h3 className={s.editorTitle}>Trips</h3>
        <p className={s.editorDesc}>
          Trips are found and grouped automatically based on flight, hotel, and other booking
          emails.
        </p>
      </div>
    </div>
    <TripsToggle onChange={onToggle} />
  </div>
);

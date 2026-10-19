import { openNewIssue } from "../../lib/external";
import { Icon } from "../Icon";
import { TRIP_COLOR } from "../TripSliceRow";
import s from "../BundleManagerModal.module.css";

/** Trips have no rules to edit; this pane just says how they're found. */
export const TripSettings = () => (
  <div className={s.editor}>
    <div className={s.editorHeader}>
      <Icon name="travel" className={s.editorIcon} style={{ color: TRIP_COLOR }} />
      <div>
        <h3 className={s.editorTitle}>Trips</h3>
        <p className={s.editorDesc}>
          Trips are found automatically. A classifier reads your flight, hotel, and other
          booking emails and groups them into trips, so there are no rules to edit here.
        </p>
      </div>
    </div>
    <section className={s.section}>
      <h4 className={s.sectionTitle}>Trips missing or wrong?</h4>
      <p className={s.helpText}>
        If trips aren't being picked up from your mail, or are put together wrong, please report
        a bug so the classifier can be improved.
      </p>
      <button type="button" className={s.primaryBtn} onClick={() => void openNewIssue("bug")}>
        Report a bug
      </button>
    </section>
  </div>
);

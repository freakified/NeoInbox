import { useMailStore } from "../../../store/mailStore";
import { Icon } from "../Icon";
import s from "../BundleManagerModal.module.css";

/** Redo-the-sorting actions, for when bundles or trips look wrong. */
export const AdvancedSettings = () => {
  const reclassify = useMailStore((st) => st.reclassify);
  const reclassifying = useMailStore((st) => st.reclassifying);
  const scan = useMailStore((st) => st.tripScan);
  const scanTrips = useMailStore((st) => st.scanTrips);
  const archiveScannedAt = scan?.archiveScannedAt;
  return (
    <div className={s.editor}>
      <div className={s.editorHeader}>
        <Icon name="tune" className={s.editorIcon} />
        <h3 className={s.editorTitle}>Advanced</h3>
      </div>
      <section className={s.section}>
        <h4 className={s.sectionTitle}>Reclassify inbox</h4>
        <p className={s.helpText}>Re-run all rules on mail already in your inbox.</p>
        <button
          type="button"
          className={s.primaryBtn}
          disabled={reclassifying}
          onClick={() => reclassify()}
        >
          {reclassifying ? "Reclassifying…" : "Reclassify inbox"}
        </button>
      </section>
      <section className={s.section}>
        <h4 className={s.sectionTitle}>Rebuild trips</h4>
        <p className={s.helpText}>
          Re-detect all trips from scratch. Trips you made or edited are kept.
        </p>
        <button
          type="button"
          className={s.primaryBtn}
          disabled={scan?.running ?? false}
          onClick={() => scanTrips({ archive: archiveScannedAt !== undefined, rebuild: true })}
        >
          {scan?.running && scan.rebuild ? "Rebuilding…" : "Rebuild trips"}
        </button>
      </section>
    </div>
  );
};

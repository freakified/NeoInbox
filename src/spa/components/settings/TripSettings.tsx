import { useMailStore } from "../../../store/mailStore";
import { Icon } from "../Icon";
import s from "../BundleManagerModal.module.css";

const formatDay = (ms: number): string =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export const TripSettings = () => {
  const scan = useMailStore((st) => st.tripScan);
  const scanTrips = useMailStore((st) => st.scanTrips);
  const stopTripScan = useMailStore((st) => st.stopTripScan);
  const running = scan?.running ?? false;
  const archiveScannedAt = scan?.archiveScannedAt;
  const pct = scan && scan.total > 0 ? Math.round((100 * scan.processed) / scan.total) : 0;

  return (
    <div className={s.editor}>
      <div className={s.editorHeader}>
        <Icon name="travel" className={s.editorIcon} />
        <div>
          <h3 className={s.editorTitle}>Trips</h3>
          <p className={s.editorDesc}>
            Travel reservations, grouped into trips.
          </p>
        </div>
      </div>

      <section className={s.section}>
        <h4 className={s.sectionTitle}>Scan archive</h4>
        <p className={s.helpText}>
          Find past trips in your imported archive (Settings → Advanced). You
          can stop and resume anytime.
        </p>
        {running ? (
          <div className={s.scanProgress}>
            <div className={s.scanBar}>
              <div className={s.scanBarFill} style={{ width: `${pct}%` }} />
            </div>
            <span className={s.helpText}>
              {scan!.total
                ? `Read ${scan!.processed.toLocaleString()} of ${scan!.total.toLocaleString()} messages`
                : "Getting ready…"}
            </span>
            <button type="button" className={s.textBtn} onClick={stopTripScan}>
              Stop
            </button>
          </div>
        ) : (
          <>
            {archiveScannedAt !== undefined && (
              <p className={s.helpText}>Last scanned {formatDay(archiveScannedAt)}.</p>
            )}
            {scan?.cancelled && scan.archive && (
              <p className={s.helpText}>
                Stopped after {scan.processed.toLocaleString()} of {scan.total.toLocaleString()} messages.
              </p>
            )}
            <button type="button" className={s.primaryBtn} onClick={() => scanTrips({ archive: true })}>
              {scan?.cancelled && scan.archive ? "Continue scanning" : "Scan archived mail"}
            </button>
          </>
        )}
      </section>

      <section className={s.section}>
        <h4 className={s.sectionTitle}>Rebuild</h4>
        <p className={s.helpText}>
          Re-detect all trips from scratch. Trips you made or edited are kept.
        </p>
        <button
          type="button"
          className={s.primaryBtn}
          disabled={running}
          onClick={() => scanTrips({ archive: archiveScannedAt !== undefined, rebuild: true })}
        >
          Rebuild trips
        </button>
      </section>
    </div>
  );
};

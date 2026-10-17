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
            Flights, stays, rental cars, and reservations, gathered into trips.
          </p>
        </div>
      </div>

      <section className={s.section}>
        <h4 className={s.sectionTitle}>Archived mail</h4>
        <p className={s.helpText}>
          NeoInbox looks for trips in mail as it arrives and in your inbox.
          Your archive probably holds past trips too, but finding them means
          reading every travel-related message stored there — often thousands.
          That can take an hour or more, and Thunderbird may feel slower while
          it runs. You can stop at any time; scanning again continues where it
          left off.
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
          Throw away the trips NeoInbox found and look again from scratch
          {archiveScannedAt !== undefined ? ", archive included" : ""}. Trips
          you made yourself, and mail you moved in or out of a trip, are kept.
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

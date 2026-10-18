import { useState } from "react";
import { useMailStore } from "../../../store/mailStore";
import {
  ARCHIVE_RANGES,
  DEFAULT_ARCHIVE_YEARS,
  formatDay,
  sinceOf,
} from "../../lib/archiveRanges";
import { Icon } from "../Icon";
import s from "../BundleManagerModal.module.css";

export const TripSettings = () => {
  const scan = useMailStore((st) => st.tripScan);
  const scanTrips = useMailStore((st) => st.scanTrips);
  const stopTripScan = useMailStore((st) => st.stopTripScan);
  const [years, setYears] = useState<number | null>(DEFAULT_ARCHIVE_YEARS);
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
          Find past trips in your archived mail. Brings in the archive that
          far back first if needed; you can stop and resume anytime.
        </p>
        {running ? (
          <div className={s.scanProgress}>
            <div className={s.scanBar}>
              <div className={s.scanBarFill} style={{ width: `${pct}%` }} />
            </div>
            <span className={s.helpText}>
              {scan!.phase === "import"
                ? "Importing archived mail…"
                : scan!.total
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
              <p className={s.helpText}>
                Last scanned {formatDay(archiveScannedAt)}
                {scan?.scannedBackTo === null
                  ? ", everything"
                  : scan?.scannedBackTo !== undefined
                    ? `, back to ${formatDay(scan.scannedBackTo)}`
                    : ""}
                .
              </p>
            )}
            <label className={s.fieldBlock}>
              <span className={s.label}>How far back</span>
              <select
                className={s.select}
                value={years ?? "all"}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setYears(v === "all" ? null : Number(v));
                }}
              >
                {ARCHIVE_RANGES.map((r) => (
                  <option key={r.label} value={r.years ?? "all"}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            {scan?.cancelled && scan.archive && (
              <p className={s.helpText}>
                Stopped after {scan.processed.toLocaleString()} of {scan.total.toLocaleString()} messages.
              </p>
            )}
            <button type="button" className={s.primaryBtn} onClick={() => scanTrips({ archive: true, importSince: sinceOf(years) })}>
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

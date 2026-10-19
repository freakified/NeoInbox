import { useState } from "react";
import { useMailStore } from "../../../store/mailStore";
import {
  ARCHIVE_RANGES as RANGES,
  DEFAULT_ARCHIVE_YEARS,
  formatDay,
  sinceOf,
} from "../../lib/archiveRanges";
import { Icon } from "../Icon";
import s from "../BundleManagerModal.module.css";

const backTo = (since: number | null | undefined): string =>
  since === null ? ", everything" : since !== undefined ? `, back to ${formatDay(since)}` : "";

/**
 * Older archived mail, brought into Done and bundles and searched for trips.
 * A trip scan imports its range first, so one button covers both; the
 * progress shown is whichever half is running.
 */
export const ArchiveSettings = () => {
  const status = useMailStore((st) => st.archiveImport);
  const scan = useMailStore((st) => st.tripScan);
  const stopArchiveImport = useMailStore((st) => st.stopArchiveImport);
  const scanTrips = useMailStore((st) => st.scanTrips);
  const stopTripScan = useMailStore((st) => st.stopTripScan);
  const [years, setYears] = useState<number | null>(DEFAULT_ARCHIVE_YEARS);
  const importing = status?.running ?? false;
  const scanning = scan?.running ?? false;

  // pct is undefined when there's nothing to measure against: the bar sweeps.
  let progress: { pct?: number; label: string; stop: () => void } | null = null;
  if (scanning && scan!.phase === "read") {
    progress = {
      pct: scan!.total > 0 ? Math.round((100 * scan!.processed) / scan!.total) : undefined,
      label: scan!.total
        ? `Finding trips · read ${scan!.processed.toLocaleString()} of ${scan!.total.toLocaleString()} messages`
        : "Getting ready…",
      stop: stopTripScan,
    };
  } else if (importing) {
    progress = {
      pct: status!.total ? Math.min(100, Math.round((100 * status!.scanned) / status!.total)) : undefined,
      label: status!.scanned
        ? `Loading · looked at ${status!.scanned.toLocaleString()} messages, added ${status!.imported.toLocaleString()}`
        : "Getting ready…",
      stop: scanning ? stopTripScan : stopArchiveImport,
    };
  } else if (scanning) {
    progress = { label: "Getting ready…", stop: stopTripScan };
  }

  const resumable = !!(scan?.cancelled && scan.archive);

  return (
    <div className={s.editor}>
      <div className={s.editorHeader}>
        <Icon name="archive" className={s.editorIcon} />
        <div>
          <h3 className={s.editorTitle}>Older mail</h3>
          <p className={s.editorDesc}>
            Bring older archived mail into Done, bundles, and trips.
          </p>
        </div>
      </div>

      <section className={s.section}>
        <h4 className={s.sectionTitle}>Archived mail</h4>
        <p className={s.helpText}>
          By default, NeoInbox only processes the emails in your inbox. But, for a more complete experience, you can bring in your archive! Depending on how many messages you have, this might take a minute or two.
        </p>
        {progress ? (
          <div className={s.scanProgress}>
            <div className={s.scanBar}>
              {progress.pct === undefined ? (
                <div className={s.scanBarIndeterminate} />
              ) : (
                <div className={s.scanBarFill} style={{ width: `${progress.pct}%` }} />
              )}
            </div>
            <span className={s.helpText}>{progress.label}</span>
            <button type="button" className={s.textBtn} onClick={progress.stop}>
              Stop
            </button>
          </div>
        ) : (
          <>
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
                {RANGES.map((r) => (
                  <option key={r.label} value={r.years ?? "all"}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={s.primaryBtn}
              onClick={() => scanTrips({ archive: true, importSince: sinceOf(years) })}
            >
              {resumable ? "Continue loading" : "Load older mail"}
            </button>
            {status?.finishedAt !== undefined && (
              <p className={s.helpText}>
                Last loaded {formatDay(status.finishedAt)}
                {backTo(status.since)}
                {status.cancelled ? " (stopped early)" : ""}.
              </p>
            )}
            {scan?.archiveScannedAt !== undefined && (
              <p className={s.helpText}>
                Last looked for trips {formatDay(scan.archiveScannedAt)}
                {backTo(scan.scannedBackTo)}.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
};

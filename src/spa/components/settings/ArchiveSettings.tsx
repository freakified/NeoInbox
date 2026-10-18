import { useState } from "react";
import { useMailStore } from "../../../store/mailStore";
import {
  ARCHIVE_RANGES as RANGES,
  DEFAULT_ARCHIVE_YEARS,
  formatDay,
  sinceOf,
} from "../../lib/archiveRanges";
import s from "../BundleManagerModal.module.css";

export const ArchiveImportSection = () => {
  const status = useMailStore((st) => st.archiveImport);
  const importArchive = useMailStore((st) => st.importArchive);
  const stopArchiveImport = useMailStore((st) => st.stopArchiveImport);
  const [years, setYears] = useState<number | null>(DEFAULT_ARCHIVE_YEARS);
  const running = status?.running ?? false;
  const pct =
    status && status.totalFolders > 0 ? Math.round((100 * status.folders) / status.totalFolders) : 0;

  return (
    <section className={s.section}>
      <h4 className={s.sectionTitle}>Import archive</h4>
      <p className={s.helpText}>
        Bring older archived mail into Done, bundles, and trips. Reads headers
        only; you can stop and resume anytime.
      </p>
      {running ? (
        <div className={s.scanProgress}>
          <div className={s.scanBar}>
            <div className={s.scanBarFill} style={{ width: `${pct}%` }} />
          </div>
          <span className={s.helpText}>
            {status!.scanned
              ? `Looked at ${status!.scanned.toLocaleString()} messages, imported ${status!.imported.toLocaleString()}`
              : "Getting ready…"}
          </span>
          <button type="button" className={s.textBtn} onClick={stopArchiveImport}>
            Stop
          </button>
        </div>
      ) : (
        <>
          {status?.finishedAt !== undefined && (
            <p className={s.helpText}>
              Last imported {formatDay(status.finishedAt)}
              {status.since !== null ? `, back to ${formatDay(status.since)}` : ", everything"}
              {status.cancelled ? " (stopped early)" : ""}.
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
            onClick={() => importArchive(sinceOf(years))}
          >
            {status?.cancelled ? "Continue importing" : "Import archived mail"}
          </button>
        </>
      )}
    </section>
  );
};

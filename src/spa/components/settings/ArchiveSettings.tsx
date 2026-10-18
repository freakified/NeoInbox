import { useState } from "react";
import { useMailStore } from "../../../store/mailStore";
import { Icon } from "../Icon";
import s from "../BundleManagerModal.module.css";

const YEAR = 365 * 24 * 60 * 60 * 1000;

/** How far back to import; null is the whole archive. */
const RANGES: { label: string; years: number | null }[] = [
  { label: "Last year", years: 1 },
  { label: "Last 2 years", years: 2 },
  { label: "Last 5 years", years: 5 },
  { label: "Everything", years: null },
];
const DEFAULT_YEARS = 2;

const formatDay = (ms: number): string =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export const ArchiveSettings = () => {
  const status = useMailStore((st) => st.archiveImport);
  const importArchive = useMailStore((st) => st.importArchive);
  const stopArchiveImport = useMailStore((st) => st.stopArchiveImport);
  const [years, setYears] = useState<number | null>(DEFAULT_YEARS);
  const running = status?.running ?? false;
  const pct =
    status && status.totalFolders > 0 ? Math.round((100 * status.folders) / status.totalFolders) : 0;

  return (
    <div className={s.editor}>
      <div className={s.editorHeader}>
        <Icon name="archive" className={s.editorIcon} />
        <div>
          <h3 className={s.editorTitle}>Archive</h3>
          <p className={s.editorDesc}>Mail you archived before installing NeoInbox.</p>
        </div>
      </div>

      <section className={s.section}>
        <h4 className={s.sectionTitle}>Import archived mail</h4>
        <p className={s.helpText}>
          NeoInbox only knows about mail that was in your inbox, or that you
          marked done here. Importing your archive brings older mail into Done
          and your bundles, and lets trips find past travel.
        </p>
        <p className={s.helpText}>
          Only headers are read — sender, subject, date — so nothing is
          downloaded from your mail server. Bundling uses those alone, so a few
          messages may land in the wrong bundle. A large archive can take
          several minutes; you can stop at any time, and importing again picks
          up where it left off.
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
            <label className={s.twoColumn} style={{ alignItems: "center" }}>
              <span>How far back</span>
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
              onClick={() => importArchive(years === null ? null : Date.now() - years * YEAR)}
            >
              {status?.cancelled ? "Continue importing" : "Import archived mail"}
            </button>
          </>
        )}
      </section>
    </div>
  );
};

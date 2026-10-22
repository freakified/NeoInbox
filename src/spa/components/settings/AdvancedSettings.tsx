import { useRef, useState } from "react";
import { useMailStore } from "../../../store/mailStore";
import { type Backup, parseBackup } from "../../../shared/backup";
import { buildBackup, describeBackup, downloadBackup } from "../../lib/backup";
import { Icon } from "../Icon";
import s from "../BundleManagerModal.module.css";

/**
 * Export and import of what the user set up by hand (see shared/backup.ts).
 * Import replaces, so a chosen file is summed up for confirmation first.
 */
const BackupSection = () => {
  const importBackup = useMailStore((st) => st.importBackup);
  const importing = useMailStore((st) => st.importingBackup);
  const fileInput = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<Backup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportNow = async () => {
    setError(null);
    try {
      downloadBackup(await buildBackup());
    } catch (e) {
      setError(`Couldn't export — ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const readFile = async (file: File) => {
    setError(null);
    try {
      setChosen(parseBackup(await file.text()));
    } catch (e) {
      setChosen(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className={s.section}>
      <h4 className={s.sectionTitle}>Back up settings</h4>
      <p className={s.helpText}>
        Save your bundles, rules, pins, reminders and settings to a file, or restore them from
        one. The file includes your translation API key, if you set one. Snoozes aren't
        included.
      </p>
      {chosen ? (
        <>
          <p className={s.helpText}>
            Replace your current setup with this backup ({describeBackup(chosen)})? Your inbox
            will be reclassified.
          </p>
          <div className={s.formActions}>
            <button
              type="button"
              className={s.primaryBtn}
              disabled={importing}
              onClick={() => importBackup(chosen)}
            >
              {importing ? "Importing…" : "Replace"}
            </button>
            <button
              type="button"
              className={s.textBtn}
              disabled={importing}
              onClick={() => setChosen(null)}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className={s.formActions}>
          <button type="button" className={s.primaryBtn} onClick={() => void exportNow()}>
            Export
          </button>
          <button type="button" className={s.textBtn} onClick={() => fileInput.current?.click()}>
            Import…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void readFile(file);
            }}
          />
        </div>
      )}
      {error && <p className={s.helpText}>{error}</p>}
    </section>
  );
};

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
      <BackupSection />
    </div>
  );
};

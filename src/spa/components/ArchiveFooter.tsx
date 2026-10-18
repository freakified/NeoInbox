import { useMailStore } from "../../store/mailStore";
import { DEFAULT_ARCHIVE_YEARS, formatDay, rangesBeyond, sinceOf } from "../lib/archiveRanges";
import { Icon } from "./Icon";
import s from "./ArchiveFooter.module.css";

/**
 * The end of Done and of Trips: where mail from before NeoInbox was installed
 * is offered, to the people who went looking for it. Nothing is read from the
 * archive until someone asks here (or in Settings). One click takes the
 * last two years; the gear opens Settings for any other range.
 */

const Progress = ({
  pct,
  label,
  onStop,
}: {
  /** Undefined while there's nothing to measure yet. */
  pct?: number;
  label: string;
  onStop: () => void;
}) => (
  <div className={s.progress} role="status">
    <div className={s.bar}>
      <div
        className={pct === undefined ? s.barIndeterminate : s.barFill}
        style={pct === undefined ? undefined : { width: `${pct}%` }}
      />
    </div>
    <span className={s.text}>{label}</span>
    <button type="button" className={s.textBtn} onClick={onStop}>
      Stop
    </button>
  </div>
);

/** The one-click range: two years. Settings offers the rest. */
const offersDefault = (covered: number | null | undefined): boolean =>
  rangesBeyond(covered).some((r) => r.years === DEFAULT_ARCHIVE_YEARS);

const Actions = ({
  action,
  onAction,
  pane,
}: {
  /** Omitted once the default range is covered: only the Settings gear stays. */
  action?: string;
  onAction: () => void;
  pane: "advanced" | "trips";
}) => {
  const openBundleSettings = useMailStore((st) => st.openBundleSettings);
  return (
    <div className={s.actions}>
      {action && (
        <button type="button" className={s.actionBtn} onClick={onAction}>
          {action}
        </button>
      )}
      <button
        type="button"
        className={s.iconBtn}
        onClick={() => openBundleSettings({ pane })}
        title="More options"
        aria-label="More options"
      >
        <Icon name="settings" className={s.icon} />
      </button>
    </div>
  );
};

export const DoneArchiveFooter = () => {
  const status = useMailStore((st) => st.archiveImport);
  const importArchive = useMailStore((st) => st.importArchive);
  const stopArchiveImport = useMailStore((st) => st.stopArchiveImport);

  if (status?.running) {
    const pct =
      status.totalFolders > 0 ? Math.round((100 * status.folders) / status.totalFolders) : undefined;
    return (
      <footer className={s.root}>
        <Progress
          pct={pct}
          label={
            status.scanned
              ? `Importing archived mail · ${status.imported.toLocaleString()} so far`
              : "Getting ready…"
          }
          onStop={stopArchiveImport}
        />
      </footer>
    );
  }

  const covered = status?.coveredSince;
  if (covered === null) return null;
  // A stopped run picks up its own range, which may be one Settings chose.
  const resumable = !!(status?.cancelled || status?.error);
  return (
    <footer className={s.root}>
      <p className={s.text}>
        {status?.error
          ? "Couldn't finish importing archived mail."
          : covered === undefined
            ? "Done shows mail archived since you started using NeoInbox."
            : `Archived mail imported back to ${formatDay(covered)}.`}
      </p>
      <Actions
        action={resumable ? "Continue importing" : offersDefault(covered) ? "Import older mail" : undefined}
        onAction={() => importArchive(resumable ? status!.since : sinceOf(DEFAULT_ARCHIVE_YEARS))}
        pane="advanced"
      />
    </footer>
  );
};

export const PastTripsFooter = () => {
  const scan = useMailStore((st) => st.tripScan);
  const importStatus = useMailStore((st) => st.archiveImport);
  const scanTrips = useMailStore((st) => st.scanTrips);
  const stopTripScan = useMailStore((st) => st.stopTripScan);

  if (scan?.running) {
    if (scan.phase === "import") {
      const pct =
        importStatus?.running && importStatus.totalFolders > 0
          ? Math.round((100 * importStatus.folders) / importStatus.totalFolders)
          : undefined;
      return (
        <footer className={s.root}>
          <Progress
            pct={pct}
            label={
              importStatus?.running && importStatus.scanned
                ? `Gathering archived mail · ${importStatus.scanned.toLocaleString()} looked at`
                : "Getting ready…"
            }
            onStop={stopTripScan}
          />
        </footer>
      );
    }
    return (
      <footer className={s.root}>
        <Progress
          pct={scan.total ? Math.round((100 * scan.processed) / scan.total) : undefined}
          label={
            scan.total
              ? `Finding trips · ${scan.processed.toLocaleString()} of ${scan.total.toLocaleString()} emails read`
              : "Getting ready…"
          }
          onStop={stopTripScan}
        />
      </footer>
    );
  }

  const reached = scan?.scannedBackTo;
  if (reached === null) return null;
  const stopped = !!(scan?.error || (scan?.cancelled && scan.archive));
  return (
    <footer className={s.root}>
      <p className={s.text}>
        {scan?.error
          ? "Couldn't finish looking for trips."
          : reached === undefined
            ? "Looking for older trips?"
            : `Trips found in archived mail back to ${formatDay(reached)}.`}
      </p>
      <Actions
        action={
          offersDefault(reached)
            ? stopped
              ? "Continue looking"
              : "Find trips in archived mail"
            : undefined
        }
        onAction={() => scanTrips({ archive: true, importSince: sinceOf(DEFAULT_ARCHIVE_YEARS) })}
        pane="trips"
      />
    </footer>
  );
};

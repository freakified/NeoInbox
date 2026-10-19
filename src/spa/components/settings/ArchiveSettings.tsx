import { useState } from "react";
import { useMailStore } from "../../../store/mailStore";
import type { ArchiveImportStatus, InboxImportStatus, TripScanStatus } from "../../../shared/messaging";
import {
  ARCHIVE_RANGES,
  DEFAULT_ARCHIVE_YEARS,
  formatDay,
  rangesBeyond,
  sinceOf,
  type ArchiveRange,
} from "../../lib/archiveRanges";
import { Icon } from "../Icon";
import s from "../BundleManagerModal.module.css";

const backTo = (since: number | null | undefined): string =>
  since === null ? ", everything" : since !== undefined ? `, back to ${formatDay(since)}` : "";

interface Progress {
  /** Undefined when there's nothing to measure against: the bar sweeps. */
  pct?: number;
  label: string;
}

/**
 * What one section's load is doing: the import it starts with, then the trip
 * scan that follows. Null while that section's load isn't running.
 */
const progressOf = (
  scan: TripScanStatus | null,
  imported: ArchiveImportStatus | InboxImportStatus | null,
  fromInbox: boolean,
): Progress | null => {
  const scanning = !!scan?.running && !!scan.fromInbox === fromInbox;
  if (scanning && scan!.phase === "read") {
    return {
      pct: scan!.total > 0 ? Math.round((100 * scan!.processed) / scan!.total) : undefined,
      label: scan!.total
        ? `Finding trips · read ${scan!.processed.toLocaleString()} of ${scan!.total.toLocaleString()} messages`
        : "Getting ready…",
    };
  }
  if (imported?.running && imported.phase === "bodies") {
    const { sorted = 0, toSort = 0 } = imported;
    return {
      pct: toSort > 0 ? Math.round((100 * sorted) / toSort) : undefined,
      label: toSort
        ? `Sorting into bundles · read ${sorted.toLocaleString()} of ${toSort.toLocaleString()} messages`
        : "Getting ready…",
    };
  }
  if (imported?.running) {
    return {
      pct: imported.total ? Math.min(100, Math.round((100 * imported.scanned) / imported.total)) : undefined,
      label: imported.scanned
        ? `Loading · looked at ${imported.scanned.toLocaleString()} messages, added ${imported.imported.toLocaleString()}`
        : "Getting ready…",
    };
  }
  return scanning ? { label: "Getting ready…" } : null;
};

const ProgressBar = ({ progress, stop }: { progress: Progress; stop: () => void }) => (
  <div className={s.scanProgress}>
    <div className={s.scanBar}>
      {progress.pct === undefined ? (
        <div className={s.scanBarIndeterminate} />
      ) : (
        <div className={s.scanBarFill} style={{ width: `${progress.pct}%` }} />
      )}
    </div>
    <span className={s.helpText}>{progress.label}</span>
    <button type="button" className={s.textBtn} onClick={stop}>
      Stop
    </button>
  </div>
);

const RangeSelect = ({
  ranges,
  years,
  onChange,
  disabled,
}: {
  ranges: ArchiveRange[];
  years: number | null;
  onChange: (years: number | null) => void;
  disabled?: boolean;
}) => (
  <label className={s.fieldBlock}>
    <span className={s.label}>How far back</span>
    <select
      className={s.select}
      value={years ?? "all"}
      disabled={disabled}
      onChange={(e) => {
        const v = e.currentTarget.value;
        onChange(v === "all" ? null : Number(v));
      }}
    >
      {ranges.map((r) => (
        <option key={r.label} value={r.years ?? "all"}>
          {r.label}
        </option>
      ))}
    </select>
  </label>
);

/**
 * Inbox mail older than the scan window, brought in from headers alone. The
 * ranges are for inboxes that are really an archive: only the ones reaching
 * past what's already loaded are offered.
 */
const InboxSection = ({ busy }: { busy: boolean }) => {
  const status = useMailStore((st) => st.inboxImport);
  const scan = useMailStore((st) => st.tripScan);
  const inboxWindow = useMailStore((st) => st.inboxWindow);
  const scanTrips = useMailStore((st) => st.scanTrips);
  const stopTripScan = useMailStore((st) => st.stopTripScan);
  const ranges = rangesBeyond(status?.coveredSince);
  const [chosen, setChosen] = useState<number | null | undefined>(undefined);
  // The default, unless an earlier load already reached past it.
  const years =
    chosen !== undefined && ranges.some((r) => r.years === chosen)
      ? chosen
      : ranges.some((r) => r.years === DEFAULT_ARCHIVE_YEARS)
        ? DEFAULT_ARCHIVE_YEARS
        : ranges[0]?.years ?? null;
  const progress = progressOf(scan, status, true);
  const left = inboxWindow?.skipped ?? 0;
  // A stopped load picks up its own range again: the messages it listed but
  // hadn't read yet are what's left, even with nothing left to list.
  const resumable =
    !!status && status.since !== undefined && (!!status.cancelled || !!(scan?.cancelled && scan.fromInbox));

  return (
    <section className={s.section}>
      <h4 className={s.sectionTitle}>Inbox</h4>
      <p className={s.helpText}>
        {progress
          ? "Your older inbox mail shows up right away, then sorts itself into bundles as each message is read. You can keep using NeoInbox meanwhile."
          : resumable
            ? "Loading stopped before all your older inbox mail was sorted into bundles. Continue to pick up where it left off."
            : left > 0
              ? `NeoInbox fully processes your newest ${inboxWindow!.cap.toLocaleString()} inbox messages. You have ${left.toLocaleString()} more — load them to see the rest of your inbox, sorted into bundles. They show up right away, then sort themselves as each one is read, which can take a while for a big inbox.`
              : inboxWindow
                ? "Your whole inbox is loaded."
                : "NeoInbox fully processes your newest inbox messages. Once your inbox has synced, you can load the rest here."}
      </p>
      {progress ? (
        <ProgressBar progress={progress} stop={stopTripScan} />
      ) : (
        <>
          {resumable ? (
            <button
              type="button"
              className={s.primaryBtn}
              disabled={busy}
              onClick={() => scanTrips({ archive: true, inboxSince: status!.since })}
            >
              Continue loading
            </button>
          ) : left > 0 && ranges.length > 0 && (
            <>
              <RangeSelect ranges={ranges} years={years} onChange={setChosen} disabled={busy} />
              <button
                type="button"
                className={s.primaryBtn}
                disabled={busy}
                onClick={() => scanTrips({ archive: true, inboxSince: sinceOf(years) })}
              >
                Load older inbox mail
              </button>
            </>
          )}
          {status?.finishedAt !== undefined && (
            <p className={s.helpText}>
              Last loaded {formatDay(status.finishedAt)}
              {backTo(status.coveredSince)}
              {status.cancelled ? " (stopped early)" : ""}.
            </p>
          )}
        </>
      )}
    </section>
  );
};

/**
 * Older archived mail, brought into Done and bundles and searched for trips.
 * A trip scan imports its range first, so one button covers both; the
 * progress shown is whichever half is running.
 */
const ArchiveSection = ({ busy }: { busy: boolean }) => {
  const status = useMailStore((st) => st.archiveImport);
  const scan = useMailStore((st) => st.tripScan);
  const stopArchiveImport = useMailStore((st) => st.stopArchiveImport);
  const scanTrips = useMailStore((st) => st.scanTrips);
  const stopTripScan = useMailStore((st) => st.stopTripScan);
  const [years, setYears] = useState<number | null>(DEFAULT_ARCHIVE_YEARS);
  const progress = progressOf(scan, status, false);
  const scanning = !!scan?.running && !scan.fromInbox;
  // A stopped load picks up its own range again: what it listed but hadn't
  // read yet is left, whatever the picker now says.
  const resumable =
    !!status &&
    status.since !== undefined &&
    (!!status.cancelled || !!(scan?.cancelled && scan.archive && !scan.fromInbox));

  return (
    <section className={s.section}>
      <h4 className={s.sectionTitle}>Archived mail</h4>
      <p className={s.helpText}>
        By default, NeoInbox only processes the emails in your inbox. But, for a more complete experience, you can bring in your archive! Archived mail shows up in Done right away, then sorts itself into bundles as each message is read, which can take a while for a big archive.
      </p>
      {progress ? (
        <ProgressBar progress={progress} stop={scanning ? stopTripScan : stopArchiveImport} />
      ) : (
        <>
          {!resumable && (
            <RangeSelect ranges={ARCHIVE_RANGES} years={years} onChange={setYears} disabled={busy} />
          )}
          <button
            type="button"
            className={s.primaryBtn}
            disabled={busy}
            onClick={() =>
              scanTrips({ archive: true, importSince: resumable ? status!.since : sinceOf(years) })
            }
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
  );
};

/**
 * Settings → Older mail: inbox mail older than the scan window, and archived
 * mail from before NeoInbox. One load at a time — they share the trip scan
 * that follows each import — so while one runs, the other section waits.
 */
export const ArchiveSettings = () => {
  const scanning = useMailStore((st) => !!st.tripScan?.running);
  const importingInbox = useMailStore((st) => !!st.inboxImport?.running);
  const importingArchive = useMailStore((st) => !!st.archiveImport?.running);
  const busy = scanning || importingInbox || importingArchive;

  return (
    <div className={s.editor}>
      <div className={s.editorHeader}>
        <Icon name="archive" className={s.editorIcon} />
        <div>
          <h3 className={s.editorTitle}>Older mail</h3>
          <p className={s.editorDesc}>
            Bring older inbox and archived mail into bundles, Done, and trips.
          </p>
        </div>
      </div>
      <InboxSection busy={busy} />
      <ArchiveSection busy={busy} />
    </div>
  );
};

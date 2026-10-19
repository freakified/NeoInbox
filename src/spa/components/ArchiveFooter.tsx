import { useMailStore } from "../../store/mailStore";
import { formatDay } from "../lib/archiveRanges";
import { searchInThunderbird } from "../lib/thunderbirdViews";
import { Icon } from "./Icon";
import s from "./ArchiveFooter.module.css";

/**
 * The end of Done, Trips and short search results: where mail from before
 * NeoInbox was installed is offered, to the people who went looking for it.
 * Nothing is read from the archive until someone asks; the button opens
 * Settings → Older mail, which picks the range and shows the progress.
 */
const OlderMailFooter = ({
  reached,
  notYet,
  reachedTo,
}: {
  /** How far back this place already covers: null for everything, undefined for nothing yet. */
  reached: number | null | undefined;
  /** Nothing loaded yet. */
  notYet: string;
  /** Loaded back to this day. */
  reachedTo: (day: string) => string;
}) => {
  const status = useMailStore((st) => st.archiveImport);
  const scan = useMailStore((st) => st.tripScan);
  const openBundleSettings = useMailStore((st) => st.openBundleSettings);
  const running = !!(status?.running || (scan?.running && scan.archive));
  if (!running && reached === null) return null;
  const failed = !!(status?.error || (scan?.archive && scan.error));
  return (
    <footer className={s.root}>
      <p className={s.text}>
        {running
          ? "Loading older mail…"
          : failed
            ? "Couldn't finish loading older mail."
            : reached == null
              ? notYet
              : reachedTo(formatDay(reached))}
      </p>
      <button
        type="button"
        className={s.actionBtn}
        onClick={() => openBundleSettings({ pane: "archive" })}
      >
        {running ? "Show progress" : "Load older mail"}
      </button>
    </footer>
  );
};

export const DoneArchiveFooter = () => {
  const covered = useMailStore((st) => st.archiveImport?.coveredSince);
  return (
    <OlderMailFooter
      reached={covered}
      notYet="Done shows mail archived since you started using NeoInbox."
      reachedTo={(day) => `Archived mail loaded back to ${day}.`}
    />
  );
};

/** Search reads only what's cached, so older archived mail can't match until loaded. */
export const SearchArchiveFooter = () => {
  const covered = useMailStore((st) => st.archiveImport?.coveredSince);
  return (
    <OlderMailFooter
      reached={covered}
      notYet="Search covers mail archived since you started using NeoInbox."
      reachedTo={(day) => `Search covers archived mail back to ${day}.`}
    />
  );
};

export const PastTripsFooter = () => {
  const reached = useMailStore((st) => st.tripScan?.scannedBackTo);
  return (
    <OlderMailFooter
      reached={reached}
      notYet="Looking for older trips?"
      reachedTo={(day) => `Trips found in archived mail back to ${day}.`}
    />
  );
};

/**
 * Bodies aren't cached; Thunderbird's own search can look in them, over the
 * whole archive (All Mail on Gmail) of the account being shown.
 */
export const ThunderbirdSearchFooter = ({ query }: { query: string }) => {
  const accountFilter = useMailStore((st) => st.accountFilter);
  return (
    <footer className={s.root}>
      <button
        type="button"
        className={`${s.actionBtn} ${s.externalBtn}`}
        onClick={() => void searchInThunderbird(query, accountFilter)}
        title="Opens in Thunderbird"
      >
        Search in Thunderbird
        <Icon name="open_in_new" className={s.externalIcon} />
      </button>
    </footer>
  );
};

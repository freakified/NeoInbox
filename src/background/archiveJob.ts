/**
 * User-started archive work (an import from Done, a trip scan from Trips or
 * Settings) can run for many minutes. If Thunderbird quits partway, the job
 * left in storage picks it back up after the next startup sync. Both halves
 * skip what they already did, so resuming is just running it again.
 */
import { log } from "../shared/log";
import { runArchiveImport } from "./archiveImport";
import { runTripScan } from "./extract";

type ArchiveJob =
  | { kind: "import"; since: number | null }
  | { kind: "trips"; importSince?: number | null; inboxSince?: number | null };

const JOB_KEY = "neoinbox-archive-job";

/**
 * Record the job, run it, clear it. A job started while another is recorded
 * (a second click, or an import from Done while Trips is importing) still
 * runs — the runners join or ignore duplicates themselves — but leaves the
 * record to the job that wrote it.
 */
const run = async (job: ArchiveJob, work: () => Promise<unknown>): Promise<void> => {
  const owns = !(await messenger.storage.local.get(JOB_KEY))[JOB_KEY];
  if (owns) await messenger.storage.local.set({ [JOB_KEY]: job });
  try {
    await work();
  } finally {
    // Finished, stopped or failed all end the job; only a quit leaves it.
    if (owns) await messenger.storage.local.remove(JOB_KEY);
  }
};

const runJob = (job: ArchiveJob): Promise<void> =>
  run(job, () =>
    job.kind === "import"
      ? runArchiveImport(job.since)
      : runTripScan({ archive: true, importSince: job.importSince, inboxSince: job.inboxSince }),
  );

export const startArchiveImport = (since: number | null): Promise<void> =>
  runJob({ kind: "import", since });

/**
 * A trip scan over archived mail. A rebuild resumes as a plain scan: the
 * reset already happened, and the reads left to do are the same.
 */
export const startArchiveTripScan = (options: {
  rebuild?: boolean;
  importSince?: number | null;
  inboxSince?: number | null;
}): Promise<void> =>
  run({ kind: "trips", importSince: options.importSince, inboxSince: options.inboxSince }, () =>
    runTripScan({ archive: true, ...options }),
  );

export const resumeArchiveJob = async (): Promise<void> => {
  const stored = await messenger.storage.local.get(JOB_KEY);
  const job = stored[JOB_KEY] as ArchiveJob | undefined;
  if (!job) return;
  log.info("archive-job", "resuming interrupted job", job);
  await messenger.storage.local.remove(JOB_KEY);
  await runJob(job);
};

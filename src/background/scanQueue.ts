/**
 * What every background mail job shares: the one-at-a-time chain scans and
 * sweeps queue on, per-call timeouts, and the progress channel to the SPA.
 */
import { broadcast } from "./port";
import type { ServerMsg } from "../shared/messaging";

export const PROGRESS_EVERY = 50;
export const BATCH_FLUSH = 100;
export const PER_MESSAGE_TIMEOUT_MS = 15_000;
/** Max messages hydrated per fillMissingDetails run; the periodic sweep continues the rest. */
export const DETAILS_FILL_LIMIT = 400;

let lastProgress: ServerMsg | null = null;

/** Scans and reclassifies run one at a time so their batches never interleave. */
let chain: Promise<unknown> = Promise.resolve();
export const serialized = <T>(work: () => Promise<T>): Promise<T> => {
  const run = chain.then(work, work);
  chain = run.catch(() => undefined);
  return run;
};

export const sendProgress = (msg: Extract<ServerMsg, { type: "backfill-progress" }>): void => {
  lastProgress = msg;
  broadcast(msg);
};

export const getLastProgress = (): ServerMsg | null => lastProgress;

export const withTimeout = async <T>(
  work: Promise<T>,
  label: string,
  ms: number = PER_MESSAGE_TIMEOUT_MS,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

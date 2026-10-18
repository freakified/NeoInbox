import type { Category, RawMessage } from "../shared/types";

/**
 * Bump whenever the classifier rules (or anything they call) change how mail
 * is categorised.
 *
 * Scans reuse a cached row's category rather than re-running the pipeline, so
 * without this stamp a rules change only ever reaches newly arriving mail: the
 * existing inbox keeps its old categories through any number of rescans, and
 * the only way to apply the new rules is pressing "Reclassify inbox" by hand.
 * Rows below the current version are re-classified by the version sweep on the
 * next background start.
 */
export const CLASSIFIER_VERSION = 5;

export interface ClassificationResult {
  category: Category | null;
  /** getFull() failed (body not synced yet); result is based on headers only. */
  incomplete: boolean;
}

/** Stamps a fresh classification onto a row. */
export const applyClassification = (
  raw: RawMessage,
  result: ClassificationResult,
): void => {
  raw.category = result.category;
  raw.classifiedIncomplete = result.incomplete;
  raw.classifierVersion = CLASSIFIER_VERSION;
}

/**
 * Carries a cached row's classification onto a rebuilt row. Rebuilding through
 * headerToRawMessage drops classifiedIncomplete and classifierVersion, which
 * strands the row outside both the retry sweep and the version sweep — it
 * keeps whatever category it has, forever.
 */
export const carryClassification = (raw: RawMessage, cached?: RawMessage): void => {
  raw.category = cached?.category ?? null;
  raw.classifiedIncomplete = cached?.classifiedIncomplete ?? false;
  raw.classifierVersion = cached?.classifierVersion;
}

/**
 * True when a cached row's category predates the current classifier rules.
 * Rows that were never classified (sent/draft, or anything cached before the
 * stamp existed) count as outdated.
 */
export const classificationOutdated = (cached: RawMessage | undefined): boolean =>
  (cached?.classifierVersion ?? 0) < CLASSIFIER_VERSION;

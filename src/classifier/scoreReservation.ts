/**
 * Scores one message's extraction against its hand-checked expectation.
 * Pure, so the eval suite and its unit tests share it.
 *
 * Segments pair up greedily by kind + start day. A paired segment is
 * "exact" when every field the label fills in (end, origin, destination)
 * agrees — fields the label leaves out aren't judged. Codes score as a set.
 */
import type { Extraction } from "./extractors/types";
import type { ExpectedReservation, ExpectedSegment } from "./samples";
import type { ReservationSegment } from "../shared/types";

/** tn/fp/fn: reservation-or-not was right/wrong; exact/partial: both found segments. */
export type Verdict = "tn" | "fp" | "fn" | "exact" | "partial";

export interface ReservationScore {
  verdict: Verdict;
  /** Expected segments with a kind+start-day partner. */
  matched: number;
  /** ...of which every labeled field also agrees. */
  exactSegments: number;
  expectedSegments: number;
  actualSegments: number;
  codesTp: number;
  codesFp: number;
  codesFn: number;
  /** Human-readable reasons, for the report. */
  problems: string[];
}

/** Local calendar day, matching how the date parser builds local midnights. */
export const dayOf = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const describe = (s: ExpectedSegment): string =>
  [s.kind, s.start, s.origin && s.destination ? `${s.origin}→${s.destination}` : ""]
    .filter(Boolean)
    .join(" ");

const fieldProblems = (want: ExpectedSegment, got: ReservationSegment): string[] => {
  const out: string[] = [];
  const gotEnd = got.end === undefined ? undefined : dayOf(got.end);
  if (want.end !== undefined && want.end !== gotEnd) out.push(`end ${gotEnd ?? "missing"} ≠ ${want.end}`);
  if (want.origin !== undefined && want.origin !== got.origin) {
    out.push(`origin ${got.origin ?? "missing"} ≠ ${want.origin}`);
  }
  if (want.destination !== undefined && want.destination !== got.destination) {
    out.push(`destination ${got.destination ?? "missing"} ≠ ${want.destination}`);
  }
  return out;
};

export const scoreReservation = (
  expected: ExpectedReservation,
  actual: Pick<Extraction, "segments" | "confirmationCodes" | "cancelled">,
): ReservationScore => {
  const problems: string[] = [];
  const unused = [...actual.segments];
  let matched = 0;
  let exactSegments = 0;

  for (const want of expected.segments) {
    const at = unused.findIndex((g) => g.kind === want.kind && dayOf(g.start) === want.start);
    if (at < 0) {
      problems.push(`missed ${describe(want)}`);
      continue;
    }
    const [got] = unused.splice(at, 1);
    matched++;
    const wrong = fieldProblems(want, got!);
    if (wrong.length) problems.push(`${describe(want)}: ${wrong.join(", ")}`);
    else exactSegments++;
  }
  for (const extra of unused) {
    problems.push(`extra ${extra.kind} ${dayOf(extra.start)} ${extra.summary ?? ""}`.trim());
  }

  const want = new Set(expected.codes.map((c) => c.toUpperCase()));
  const got = new Set(actual.confirmationCodes.map((c) => c.toUpperCase()));
  let codesTp = 0;
  for (const c of got) if (want.has(c)) codesTp++;
  const codesFp = got.size - codesTp;
  const codesFn = want.size - codesTp;
  for (const c of got) if (!want.has(c)) problems.push(`extra code ${c}`);
  for (const c of want) if (!got.has(c)) problems.push(`missed code ${c}`);

  const cancelledWrong = Boolean(expected.cancelled) !== actual.cancelled;
  if (cancelledWrong) problems.push(`cancelled ${actual.cancelled} ≠ ${Boolean(expected.cancelled)}`);

  const wantAny = expected.segments.length > 0;
  const gotAny = actual.segments.length > 0;
  const verdict: Verdict = !wantAny
    ? gotAny ? "fp" : "tn"
    : !gotAny
      ? "fn"
      : exactSegments === expected.segments.length && !unused.length && !cancelledWrong
        ? "exact"
        : "partial";

  return {
    verdict,
    matched,
    exactSegments,
    expectedSegments: expected.segments.length,
    actualSegments: actual.segments.length,
    codesTp,
    codesFp,
    codesFn,
    problems,
  };
};

/**
 * Scores the reservation extractors against hand-labeled real mail.
 *
 *   pnpm eval                  // score reviewed labels, diff against last run
 *   EVAL_DRAFT=1 pnpm eval     // also draft .expect.json for unlabeled samples
 *   EVAL_ONLY=southwest pnpm eval  // just samples whose path contains this,
 *                                  // printing each one's extraction
 *
 * Drafts are the extractor's own current output with reviewed:false — a
 * starting point to correct by hand, never scored until flipped to true.
 * The full per-sample breakdown lands in fixtures/real-mail/_reports/.
 */
import { describe, expect, it } from "vitest";
import { runExtractors } from "../classifier/extractors";
import { findConfirmationCodes } from "../classifier/extractors/text";
import { buildExtractorInput, type ExpectedReservation } from "../classifier/samples";
import { dayOf, scoreReservation, type ReservationScore, type Verdict } from "../classifier/scoreReservation";
import { hasSamples, loadSamples, rotateReport, writeExpect } from "./realMail";

interface SampleResult {
  name: string;
  subject: string;
  extractor: string;
  verdict: Verdict;
  problems: string[];
}

interface Report {
  at: string;
  results: SampleResult[];
}

const RANK: Record<Verdict, number> = { exact: 2, tn: 2, partial: 1, fn: 0, fp: 0 };

const pct = (n: number, d: number): string => (d ? `${Math.round((100 * n) / d)}%` : "–");

/** Recent mail decides new trips, so it's scored apart from the archive. */
const eraOf = (ms: number): string => {
  const year = new Date(ms).getFullYear();
  return year >= 2024 ? "2024+" : year >= 2022 ? "2022–23" : "≤2021";
};

describe("reservation extractors vs real mail", () => {
  it.skipIf(!hasSamples())("scores every reviewed sample", () => {
    const only = process.env.EVAL_ONLY;
    const samples = loadSamples("trips").filter((s) => !only || s.name.includes(only));
    const draft = Boolean(process.env.EVAL_DRAFT);
    const results: SampleResult[] = [];
    const scores: { domain: string; era: string; score: ReservationScore }[] = [];
    let unreviewed = 0;
    let drafted = 0;

    for (const s of samples) {
      const input = buildExtractorInput(s.sample);
      const hit = runExtractors(input);
      // Mirror the sweep: no reservation still records the codes it saw.
      const actual = hit ?? {
        segments: [],
        confirmationCodes: findConfirmationCodes(input.text, input.subject),
        cancelled: false,
      };

      const label = s.expect?.reservation?.reviewed ? s.expect.reservation : undefined;
      if (only) {
        const segs = actual.segments.map((g) =>
          [g.kind, dayOf(g.start), g.end !== undefined ? `..${dayOf(g.end)}` : "", g.origin ?? "", g.destination ? `>${g.destination}` : ""].join(" "),
        );
        console.log(`${s.name}  [${hit?.extractor ?? "none"}]\n  got:  ${segs.join("; ") || "-"} | ${actual.confirmationCodes.join(",")}` +
          `\n  want: ${label ? label.segments.map((g) => `${g.kind} ${g.start}${g.end ? `..${g.end}` : ""} ${g.origin ?? ""}${g.destination ? `>${g.destination}` : ""}`).join("; ") || "-" : "(unreviewed)"} | ${label?.codes.join(",") ?? ""}`);
      }
      if (!label) {
        unreviewed++;
        if (draft && s.expect?.reservation === undefined) {
          const reservation: ExpectedReservation = {
            reviewed: false,
            segments: actual.segments.map((seg) => ({
              kind: seg.kind,
              start: dayOf(seg.start),
              ...(seg.end !== undefined ? { end: dayOf(seg.end) } : {}),
              ...(seg.origin ? { origin: seg.origin } : {}),
              ...(seg.destination ? { destination: seg.destination } : {}),
            })),
            codes: actual.confirmationCodes,
            ...(actual.cancelled ? { cancelled: true } : {}),
          };
          writeExpect(s.expectPath, { ...s.expect, reservation });
          drafted++;
        }
        continue;
      }

      const score = scoreReservation(label, actual);
      scores.push({ domain: s.sample.senderDomain, era: eraOf(s.sample.date), score });
      results.push({
        name: s.name,
        subject: s.sample.subject,
        extractor: hit?.extractor ?? "",
        verdict: score.verdict,
        problems: score.problems,
      });
    }

    // Per-sender rows (busiest first), then per-era rows, then the total.
    const rows: Record<string, Record<string, string | number>> = {};
    const groups = new Map<string, ReservationScore[]>();
    const add = (group: string, score: ReservationScore): void => {
      groups.set(group, [...(groups.get(group) ?? []), score]);
    };
    const perDomain = new Map<string, number>();
    for (const s of scores) perDomain.set(s.domain, (perDomain.get(s.domain) ?? 0) + 1);
    for (const s of [...scores].sort((a, b) => perDomain.get(b.domain)! - perDomain.get(a.domain)!)) {
      add(s.domain, s.score);
    }
    for (const era of ["2024+", "2022–23", "≤2021"]) {
      for (const s of scores) if (s.era === era) add(`ERA ${era}`, s.score);
    }
    groups.set("TOTAL", scores.map((s) => s.score));
    for (const [domain, list] of groups) {
      const count = (v: Verdict): number => list.filter((s) => s.verdict === v).length;
      const sum = (f: (s: ReservationScore) => number): number => list.reduce((n, s) => n + f(s), 0);
      rows[domain] = {
        n: list.length,
        exact: count("exact"),
        partial: count("partial"),
        fn: count("fn"),
        fp: count("fp"),
        tn: count("tn"),
        "seg recall": pct(sum((s) => s.matched), sum((s) => s.expectedSegments)),
        "seg precision": pct(sum((s) => s.matched), sum((s) => s.actualSegments)),
        "fields ok": pct(sum((s) => s.exactSegments), sum((s) => s.matched)),
        "code recall": pct(sum((s) => s.codesTp), sum((s) => s.codesTp + s.codesFn)),
        "code precision": pct(sum((s) => s.codesTp), sum((s) => s.codesTp + s.codesFp)),
      };
    }
    console.log(
      `\n[eval] ${samples.length} samples: ${results.length} scored, ${unreviewed} unreviewed` +
        (draft ? `, ${drafted} drafts written` : ""),
    );
    if (results.length) console.table(rows);

    // A filtered run would clobber the full report the next diff relies on.
    const previous = only ? null : rotateReport<Report>("reservations", { at: new Date().toISOString(), results });
    if (previous) {
      const before = new Map(previous.results.map((r) => [r.name, r.verdict] as const));
      const changes = results.filter((r) => before.has(r.name) && before.get(r.name) !== r.verdict);
      const better = changes.filter((r) => RANK[r.verdict] > RANK[before.get(r.name)!]);
      const worse = changes.filter((r) => RANK[r.verdict] < RANK[before.get(r.name)!]);
      console.log(`[eval] vs last run: ${better.length} better, ${worse.length} worse`);
      for (const r of worse) {
        console.log(`  WORSE ${before.get(r.name)} → ${r.verdict}  ${r.name}  ${r.problems.join("; ")}`);
      }
      for (const r of better) console.log(`  better ${before.get(r.name)} → ${r.verdict}  ${r.name}`);
    }

    // A report, not a gate: the only hard failure is a crash above.
    expect(results.length + unreviewed).toBe(samples.length);
  });
});

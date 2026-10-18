/**
 * Scores parcel tracking (findParcels) against hand-labeled real mail.
 *
 *   pnpm eval                       // score reviewed labels, diff against last run
 *   EVAL_ONLY=yodobashi pnpm eval   // just samples whose path contains this,
 *                                   // printing each one's got/want
 *
 * Labels live under `parcels` in each sample's .expect.json; conventions on
 * ExpectedParcels in src/classifier/samples.ts.
 */
import { describe, expect, it } from "vitest";
import { findParcels } from "../classifier/extractors/tracking";
import { buildExtractorInput, type ExpectedParcel } from "../classifier/samples";
import type { Parcel } from "../shared/types";
import { hasSamples, loadSamples, rotateReport } from "./realMail";

type Verdict = "exact" | "partial" | "fn" | "fp" | "tn";

interface ParcelScore {
  verdict: Verdict;
  expected: number;
  actual: number;
  matched: number;
  /** Matched numbers whose carrier disagrees with a label that names one. */
  wrongCarrier: number;
  problems: string[];
}

interface SampleResult {
  name: string;
  subject: string;
  verdict: Verdict;
  problems: string[];
}

interface Report {
  at: string;
  results: SampleResult[];
}

const RANK: Record<Verdict, number> = { exact: 2, tn: 2, partial: 1, fn: 0, fp: 0 };

const pct = (n: number, d: number): string => (d ? `${Math.round((100 * n) / d)}%` : "–");

const show = (p: ExpectedParcel | Parcel): string => (p.number ? `${p.carrier}:${p.number}` : p.carrier);

/**
 * Numbered parcels match on the number; a label of "unknown" accepts any
 * carrier the extractor inferred. Link-only parcels match on carrier.
 */
const scoreParcels = (want: readonly ExpectedParcel[], got: readonly Parcel[]): ParcelScore => {
  const problems: string[] = [];
  const left = [...got];
  let matched = 0;
  let wrongCarrier = 0;
  for (const w of want) {
    const i = left.findIndex((g) => (w.number ? g.number === w.number : !g.number && g.carrier === w.carrier));
    if (i < 0) {
      problems.push(`missed ${show(w)}`);
      continue;
    }
    const g = left.splice(i, 1)[0]!;
    matched++;
    if (w.carrier !== "unknown" && g.carrier !== w.carrier) {
      wrongCarrier++;
      problems.push(`carrier ${g.carrier}≠${w.carrier} for ${w.number ?? "link"}`);
    }
  }
  for (const g of left) problems.push(`extra ${show(g)}`);
  const verdict: Verdict =
    !want.length && !got.length ? "tn"
    : !want.length ? "fp"
    : !got.length ? "fn"
    : !problems.length ? "exact"
    : "partial";
  return { verdict, expected: want.length, actual: got.length, matched, wrongCarrier, problems };
};

describe("parcel tracking vs real mail", () => {
  it.skipIf(!hasSamples())("scores every reviewed sample", () => {
    const only = process.env.EVAL_ONLY;
    const samples = loadSamples("packages").filter((s) => !only || s.name.includes(only));
    const results: SampleResult[] = [];
    const scores: { domain: string; score: ParcelScore }[] = [];
    let unreviewed = 0;

    for (const s of samples) {
      const label = s.expect?.parcels?.reviewed ? s.expect.parcels : undefined;
      if (!label) {
        unreviewed++;
        continue;
      }
      const got = findParcels(buildExtractorInput(s.sample));
      const score = scoreParcels(label.parcels, got);
      if (only) {
        console.log(
          `${s.name}  ${s.sample.subject.slice(0, 60)}\n  got:  ${got.map(show).join(", ") || "-"}` +
            `\n  want: ${label.parcels.map(show).join(", ") || "-"}  [${score.verdict}]`,
        );
      }
      scores.push({ domain: s.sample.senderDomain, score });
      results.push({ name: s.name, subject: s.sample.subject, verdict: score.verdict, problems: score.problems });
    }

    const groups = new Map<string, ParcelScore[]>();
    const perDomain = new Map<string, number>();
    for (const s of scores) perDomain.set(s.domain, (perDomain.get(s.domain) ?? 0) + 1);
    for (const s of [...scores].sort((a, b) => perDomain.get(b.domain)! - perDomain.get(a.domain)!)) {
      groups.set(s.domain, [...(groups.get(s.domain) ?? []), s.score]);
    }
    groups.set("TOTAL", scores.map((s) => s.score));
    const rows: Record<string, Record<string, string | number>> = {};
    for (const [domain, list] of groups) {
      if (domain !== "TOTAL" && list.length < 8 && list.every((s) => s.verdict === "exact" || s.verdict === "tn")) continue;
      const count = (v: Verdict): number => list.filter((s) => s.verdict === v).length;
      const sum = (f: (s: ParcelScore) => number): number => list.reduce((n, s) => n + f(s), 0);
      rows[domain] = {
        n: list.length,
        exact: count("exact"),
        tn: count("tn"),
        partial: count("partial"),
        fn: count("fn"),
        fp: count("fp"),
        recall: pct(sum((s) => s.matched), sum((s) => s.expected)),
        precision: pct(sum((s) => s.matched), sum((s) => s.actual)),
        "carrier ok": pct(sum((s) => s.matched - s.wrongCarrier), sum((s) => s.matched)),
      };
    }
    console.log(`\n[eval] ${samples.length} package samples: ${results.length} scored, ${unreviewed} unreviewed`);
    if (results.length) console.table(rows);

    const previous = only ? null : rotateReport<Report>("parcels", { at: new Date().toISOString(), results });
    if (previous) {
      const before = new Map(previous.results.map((r) => [r.name, r.verdict] as const));
      const changes = results.filter((r) => before.has(r.name) && before.get(r.name) !== r.verdict);
      const better = changes.filter((r) => RANK[r.verdict] > RANK[before.get(r.name)!]);
      const worse = changes.filter((r) => RANK[r.verdict] < RANK[before.get(r.name)!]);
      console.log(`[eval] vs last run: ${better.length} better, ${worse.length} worse`);
      for (const r of worse) console.log(`  WORSE ${before.get(r.name)} → ${r.verdict}  ${r.name}  ${r.problems.join("; ")}`);
      for (const r of better) console.log(`  better ${before.get(r.name)} → ${r.verdict}  ${r.name}`);
    }
    if (!only) {
      for (const r of results) {
        if (r.verdict !== "exact" && r.verdict !== "tn") console.log(`  ${r.verdict.padEnd(7)} ${r.name}  ${r.problems.join("; ")}`);
      }
    }

    // A report, not a gate: the only hard failure is a crash above.
    expect(results.length + unreviewed).toBe(samples.length);
  });
});

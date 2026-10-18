/**
 * `neoSampleDump()` — copies real mail into fixtures/real-mail/ so detectors
 * can be scored offline (`pnpm eval`) instead of by eyeballing hit counts.
 *
 * The extension can't write files, so samples are POSTed one at a time to
 * the local receiver (`pnpm samples:receive`, scripts/sample-server.mjs),
 * which only listens on 127.0.0.1 and writes into the gitignored folder.
 *
 *   await neoSampleDump()                      // every trip candidate, incl. archive
 *   await neoSampleDump({ set: "trips", max: 50 })
 *   await neoSampleDump({ set: "packages" })   // also "bills", "schemaorg"
 *
 * Re-dumping overwrites a sample's body but never touches its .expect.json.
 * New detectors register a set in SAMPLE_SETS selecting their candidates.
 */
import { collectBodies, isTripCandidate, type Part } from "./extract";
import { withTimeout } from "./scanQueue";
import { extractFeatures } from "../classifier/features";
import { matchesFinance } from "../classifier/rules/finance";
import { matchesPurchases } from "../classifier/rules/purchases";
import type { MailSample } from "../classifier/samples";
import { liveTbId } from "../shared/liveMessage";
import { pinKeyOf } from "../shared/pinKey";
import { parseSender } from "../shared/senders";
import type { RawMessage } from "../shared/types";
import { db } from "../store/db";

interface SampleSet {
  /** Candidates by header, before any body is fetched. */
  select: (m: RawMessage) => boolean;
  /** Body-level filter for sets the headers can't decide. */
  keep?: (htmlParts: readonly string[]) => boolean;
}

const isReceived = (m: RawMessage): boolean => m.origin === "inbox" || m.origin === "done";

/** JSON-LD or microdata — the markup Gmail's own cards were built on. */
const SCHEMA_ORG_RE = /application\/ld\+json|itemtype\s*=\s*["']?https?:\/\/schema\.org/i;

const SAMPLE_SETS: Record<string, SampleSet> = {
  trips: { select: (m) => isTripCandidate(m, true) },
  // Purchase mail broadly, not just shipping notices: the question is how much
  // of it carries a usable tracking number at all. Informed Delivery is a
  // daily digest of the mailbox, not tracking for something you're expecting.
  packages: {
    select: (m) =>
      isReceived(m) &&
      !/(^|\.)informeddelivery\.usps\.com$/.test(parseSender(m.author).domain) &&
      (m.category === "purchases" || matchesPurchases(extractFeatures(m, {}))),
  },
  bills: {
    select: (m) =>
      isReceived(m) && (m.category === "finance" || matchesFinance(extractFeatures(m, {}))),
  },
  // Fetches the body of nearly every received message; pass `max` to sample.
  schemaorg: {
    select: (m) => isReceived(m) && m.category !== "personal",
    keep: (html) => html.some((h) => SCHEMA_ORG_RE.test(h)),
  },
};

const RECEIVER = "http://127.0.0.1:5198";

interface DumpOptions {
  set?: string;
  max?: number;
}

interface DumpReport {
  set: string;
  selected: number;
  written: number;
  created: number;
  /** Fetched but dropped by the set's body filter. */
  filtered: number;
  failed: number;
}

export const installSampleDump = (): void => {
  (globalThis as Record<string, unknown>).neoSampleDump = async (
    options: DumpOptions = {},
  ): Promise<DumpReport | null> => {
    const { set = "trips", max = Infinity } = options;
    const sampleSet = SAMPLE_SETS[set];
    if (!sampleSet) {
      console.error(`[sample-dump] unknown set "${set}"; known: ${Object.keys(SAMPLE_SETS).join(", ")}`);
      return null;
    }
    try {
      await fetch(`${RECEIVER}/ping`);
    } catch {
      console.error("[sample-dump] receiver not running — start it with `pnpm samples:receive`");
      return null;
    }

    // Inbox and archive copies of one message share a key; keep the newest.
    const byKey = new Map<string, RawMessage>();
    for (const m of await db.messages.toArray()) {
      if (!sampleSet.select(m)) continue;
      const key = pinKeyOf(m);
      const prev = byKey.get(key);
      if (!prev || m.date > prev.date) byKey.set(key, m);
    }

    const report: DumpReport = { set, selected: byKey.size, written: 0, created: 0, filtered: 0, failed: 0 };
    let done = 0;
    for (const [key, m] of byKey) {
      if (done >= max) break;
      done++;
      if (done % 50 === 0) console.log(`[sample-dump] ${done}/${Math.min(byKey.size, max)}…`);
      try {
        const liveId = await withTimeout(liveTbId(m), `resolve ${m.key}`);
        if (liveId === null) throw new Error("message no longer exists");
        const full = await withTimeout(messenger.messages.getFull(liveId), `getFull ${liveId}`);
        const textParts: string[] = [];
        const htmlParts: string[] = [];
        collectBodies(full as Part, textParts, htmlParts);
        if (sampleSet.keep && !sampleSet.keep(htmlParts)) {
          report.filtered++;
          continue;
        }
        const sample: MailSample = {
          key,
          set,
          author: m.author,
          senderDomain: parseSender(m.author).domain || "unknown",
          subject: m.subject,
          date: m.date,
          headers: full.headers ?? {},
          textParts,
          htmlParts,
        };
        const res = await fetch(`${RECEIVER}/sample`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sample),
        });
        if (!res.ok) throw new Error(`receiver said ${res.status}`);
        const { created } = (await res.json()) as { created: boolean };
        report.written++;
        if (created) report.created++;
      } catch (e) {
        report.failed++;
        console.warn("[sample-dump] skipped", m.key, m.subject, String(e));
      }
    }
    console.log(
      `[sample-dump] set "${set}": ${report.written} written (${report.created} new), ` +
        `${report.filtered} filtered out, ${report.failed} failed, of ${report.selected} selected`,
    );
    return report;
  };
};

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
 *
 * Re-dumping overwrites a sample's body but never touches its .expect.json.
 * New detectors register a set in SAMPLE_SETS selecting their candidates.
 */
import { collectBodies, isTripCandidate, type Part } from "./extract";
import { withTimeout } from "./scanQueue";
import type { MailSample } from "../classifier/samples";
import { liveTbId } from "../shared/liveMessage";
import { pinKeyOf } from "../shared/pinKey";
import { parseSender } from "../shared/senders";
import type { RawMessage } from "../shared/types";
import { db } from "../store/db";

const SAMPLE_SETS: Record<string, (m: RawMessage) => boolean> = {
  trips: (m) => isTripCandidate(m, true),
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
  failed: number;
}

export const installSampleDump = (): void => {
  (globalThis as Record<string, unknown>).neoSampleDump = async (
    options: DumpOptions = {},
  ): Promise<DumpReport | null> => {
    const { set = "trips", max = Infinity } = options;
    const select = SAMPLE_SETS[set];
    if (!select) {
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
      if (!select(m)) continue;
      const key = pinKeyOf(m);
      const prev = byKey.get(key);
      if (!prev || m.date > prev.date) byKey.set(key, m);
    }

    const report: DumpReport = { set, selected: byKey.size, written: 0, created: 0, failed: 0 };
    let done = 0;
    for (const [key, m] of byKey) {
      if (done >= max) break;
      done++;
      try {
        const liveId = await withTimeout(liveTbId(m), `resolve ${m.key}`);
        if (liveId === null) throw new Error("message no longer exists");
        const full = await withTimeout(messenger.messages.getFull(liveId), `getFull ${liveId}`);
        const textParts: string[] = [];
        const htmlParts: string[] = [];
        collectBodies(full as Part, textParts, htmlParts);
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
      if (done % 50 === 0) console.log(`[sample-dump] ${done}/${Math.min(byKey.size, max)}…`);
    }
    console.log(
      `[sample-dump] set "${set}": ${report.written} written (${report.created} new), ` +
        `${report.failed} failed, of ${report.selected} selected`,
    );
    return report;
  };
};

/**
 * `neoClassifyDump()` — a background-console tool for turning real mail into
 * classifier corpus cases, in the same spirit as neoTripExtract/neoTripDebug.
 *
 * Two jobs. It reports where the current rules and the cached categories
 * disagree, which is how you find mail sitting in the wrong bundle without
 * scrolling for it. And it emits ready-to-paste entries for
 * src/classifier/corpus.ts so a misclassification becomes a test before it
 * becomes a fix.
 */
import { classifyByRules } from "../classifier/pipeline";
import { extractFeatures } from "../classifier/features";
import { db } from "../store/db";
import { log } from "../shared/log";
import type { Category, RawMessage } from "../shared/types";

interface DumpOptions {
  /** Only dump rows whose cached category differs from what the rules say now. */
  disagreementsOnly?: boolean;
  /** Restrict to rows currently in this category ("none" for unbundled). */
  category?: string;
  /** How many entries to emit (default 50). */
  max?: number;
  /**
   * Replace sender local parts with a placeholder. On by default because the
   * output is destined for a git repo. Prefixes the rules actually key on
   * (no-reply, orders, notifications, …) are preserved, as is every domain,
   * so a redacted case classifies exactly like the real one.
   */
  redact?: boolean;
}

interface DumpEntry {
  name: string;
  author: string;
  subject: string;
  headers?: Record<string, string[]>;
  expect: Category | null;
}

/** Header names any rule looks at; nothing else is worth dumping or storing. */
const RELEVANT_HEADERS = ["list-id", "list-post", "list-unsubscribe", "mailing-list"];

/** Local-part prefixes the rules match on, which must survive redaction. */
const MEANINGFUL_PREFIX =
  /^(no-?reply|noreply|donotreply|do-not-reply|notifications?|auto|automated|mailer-daemon|postmaster|orders?|receipts?|shipment|shipping|delivery|store|reservations?|itinerary|bookings?)/;

/**
 * Anonymises a sender without changing how it classifies.
 *
 * The domain is kept verbatim (every domain-list rule needs it) and a
 * meaningful local-part prefix is preserved (several rules key on those).
 * Everything else goes, including the display name — no rule reads it, and it
 * is usually the most identifying part of the header.
 */
export const redactAuthor = (author: string): string => {
  const match = /([^\s<@]+)@([^\s>]+)/.exec(author);
  if (!match) return author;
  const [, local = "", domain = ""] = match;
  const prefix = MEANINGFUL_PREFIX.exec(local.toLowerCase())?.[0];
  return `${prefix ?? "someone"}@${domain.replace(/[>,;]+$/, "")}`;
};

const relevantHeaders = (
  headers: Record<string, string[]>,
): Record<string, string[]> | undefined => {
  const kept: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(headers)) {
    if (RELEVANT_HEADERS.includes(key.toLowerCase())) kept[key] = values;
  }
  return Object.keys(kept).length ? kept : undefined;
};

export const installClassifyDump = (): void => {
  (globalThis as Record<string, unknown>).neoClassifyDump = async (
    options: DumpOptions = {},
  ): Promise<DumpEntry[]> => {
    const { disagreementsOnly = false, category, max = 50, redact = true } = options;

    const rows = (await db.messages.toArray()).filter(
      (m: RawMessage) => m.origin === "inbox" || m.origin === "done",
    );

    const entries: DumpEntry[] = [];
    const disagreements: { id: number; cached: string; now: string; subject: string }[] = [];
    const counts: Record<string, { cached: number; now: number }> = {};
    let unread = 0;

    for (const row of rows) {
      let headers: Record<string, string[]> = {};
      try {
        const full = await messenger.messages.getFull(row.id);
        headers = full.headers ?? {};
      } catch {
        // No body synced: the rules would see bare headers here too, so the
        // row is not a usable corpus case. Counted, then skipped.
        unread++;
        continue;
      }

      const header = await messenger.messages.get(row.id);
      const now = classifyByRules(extractFeatures(header, headers));
      const cached = row.category ?? null;

      const cachedKey = cached ?? "none";
      const nowKey = now ?? "none";
      counts[cachedKey] ??= { cached: 0, now: 0 };
      counts[nowKey] ??= { cached: 0, now: 0 };
      counts[cachedKey]!.cached++;
      counts[nowKey]!.now++;

      if (cached !== now) {
        disagreements.push({ id: row.id, cached: cachedKey, now: nowKey, subject: row.subject });
      }
      if (disagreementsOnly && cached === now) continue;
      if (category !== undefined && cachedKey !== category) continue;
      if (entries.length >= max) continue;

      entries.push({
        name: `TODO: describe this case`,
        author: redact ? redactAuthor(row.author) : row.author,
        subject: row.subject,
        ...(relevantHeaders(headers) ? { headers: relevantHeaders(headers) } : {}),
        expect: now,
      });
    }

    console.log(
      `[classify-dump] ${rows.length} cached rows, ${unread} skipped (no body synced)\n` +
        `  ${disagreements.length} disagree with the current rules\n` +
        `  emitting ${entries.length} corpus entries` +
        (redact ? " (redacted — pass {redact:false} for raw senders)" : " (RAW SENDERS)"),
    );
    console.table(counts);
    if (disagreements.length) console.table(disagreements.slice(0, 50));
    console.log(
      "[classify-dump] paste into src/classifier/corpus.ts, then set `expect` to " +
        "the category each message *should* land in.\n" +
        "  Note: subjects are emitted verbatim — the rules read them, so they " +
        "cannot be redacted. Read them before committing.",
    );
    console.log(JSON.stringify(entries, null, 2));

    (globalThis as Record<string, unknown>).neoClassifyDumpLast = { entries, disagreements };
    return entries;
  };

  log.debug("classify-dump", "neoClassifyDump() available");
};

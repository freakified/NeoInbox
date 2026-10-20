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
import { liveTbId } from "../shared/liveMessage";
import { classifyByRules } from "../classifier/pipeline";
import { getTripsEnabled } from "../shared/tripsSetting";
import { CAMPAIGN_HEADER_PREFIXES, extractFeatures } from "../classifier/features";
import {
  isPersonLocalPart,
  MACHINE_SENDER_RE,
  ROLE_SENDER_RE,
} from "../classifier/signals";
import { FORUM_HEADER_PREFIXES } from "../classifier/rules/forums";
import { SOCIAL_HEADER_PREFIXES } from "../classifier/rules/social";
import { SERVICE_HEADER_PREFIXES } from "../classifier/rules/updates";
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

/**
 * Headers whose *value* a rule reads, so they are dumped verbatim. List-Id in
 * particular decides Forums by its host, and Precedence by its word.
 */
const VERBATIM_HEADERS = [
  "list-id",
  "list-post",
  "list-unsubscribe",
  "mailing-list",
  "precedence",
  "auto-submitted",
];

/**
 * Headers where only presence is a signal. Their values carry message-ids and
 * per-account campaign identifiers, so they are dumped as a placeholder: a
 * corpus case built from one classifies identically without carrying anything
 * that points back at the account.
 */
const PRESENCE_ONLY_HEADERS = ["in-reply-to", "references"];

const PRESENCE_ONLY_PREFIXES = [
  ...CAMPAIGN_HEADER_PREFIXES,
  ...FORUM_HEADER_PREFIXES,
  ...SOCIAL_HEADER_PREFIXES,
  ...SERVICE_HEADER_PREFIXES,
];

const PRESENCE_PLACEHOLDER = ["<redacted>"];

/**
 * Anonymises a sender without changing how it classifies.
 *
 * The domain is kept verbatim (every domain-list rule needs it) and whatever
 * the rules key on in the local part is preserved: the machine or role prefix
 * that MACHINE_SENDER_RE and ROLE_SENDER_RE match, or — for an address the
 * rules read as a person — the fact that it is `first.last` shaped, which is
 * what keeps a human sender out of a bundle. Everything else goes, including
 * the display name, which no rule reads and which is usually the most
 * identifying part of the header.
 *
 * Both regexes capture the prefix they matched in group 1, so the placeholder
 * is the real prefix rather than a guess at one.
 */
export const redactAuthor = (author: string): string => {
  const match = /([^\s<@]+)@([^\s>]+)/.exec(author);
  if (!match) return author;
  const [, rawLocal = "", rawDomain = ""] = match;
  const local = rawLocal.toLowerCase();
  const domain = rawDomain.replace(/[>,;]+$/, "").toLowerCase();
  const prefix =
    MACHINE_SENDER_RE.exec(local)?.[1] ??
    ROLE_SENDER_RE.exec(local)?.[1] ??
    (isPersonLocalPart(local, domain) ? "first.last" : "someone");
  return `${prefix}@${domain}`;
};

export const relevantHeaders = (
  headers: Record<string, string[]>,
): Record<string, string[]> | undefined => {
  const kept: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(headers)) {
    const name = key.toLowerCase();
    if (VERBATIM_HEADERS.includes(name)) kept[key] = values;
    else if (
      PRESENCE_ONLY_HEADERS.includes(name) ||
      PRESENCE_ONLY_PREFIXES.some((p) => name.startsWith(p))
    ) {
      kept[key] = PRESENCE_PLACEHOLDER;
    }
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
      const tbId = await liveTbId(row);
      if (tbId === null) continue;
      try {
        const full = await messenger.messages.getFull(tbId);
        headers = full.headers ?? {};
      } catch {
        // No body synced: the rules would see bare headers here too, so the
        // row is not a usable corpus case. Counted, then skipped.
        unread++;
        continue;
      }

      const header = await messenger.messages.get(tbId);
      const now = classifyByRules(extractFeatures(header, headers), await getTripsEnabled());
      const cached = row.category ?? null;

      const cachedKey = cached ?? "none";
      const nowKey = now ?? "none";
      counts[cachedKey] ??= { cached: 0, now: 0 };
      counts[nowKey] ??= { cached: 0, now: 0 };
      counts[cachedKey]!.cached++;
      counts[nowKey]!.now++;

      if (cached !== now) {
        disagreements.push({ id: tbId, cached: cachedKey, now: nowKey, subject: row.subject });
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

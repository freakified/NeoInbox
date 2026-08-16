/**
 * Diagnostic survey: how many of the travel emails in this mailbox carry
 * machine-readable schema.org reservation markup (JSON-LD or microdata)?
 *
 * Not wired into any UI. Run from the background debug console
 * (Tools → Developer Tools → Debug Add-ons → Inspect → Console):
 *
 *   await neoTripScan()                          // inbox, travel candidates only
 *   await neoTripScan({ everything: true })      // getFull every message (slow)
 *   await neoTripScan({ fromDate: "2018-01-01", max: 5000 })
 *   await neoTripScan({ includeArchive: true })  // also walks All Mail (very slow)
 *
 * The full per-message hits (including parsed JSON-LD payloads) are kept at
 * globalThis.neoTripScanLast for poking around after a run.
 */
import { extractFeatures } from "../classifier/features";
import { matchesTravel } from "../classifier/rules/travel";
import { collectArchiveFolders, collectInboxFolders } from "../shared/folders";
import { parseSender } from "../shared/senders";
import { log } from "../shared/log";

interface TripScanOptions {
  /** getFull every message instead of only travel-looking candidates. */
  everything?: boolean;
  /** Stop after this many candidates have been fetched. */
  max?: number;
  /** Only look at messages on/after this date (Date, ms, or parseable string). */
  fromDate?: Date | number | string;
  /**
   * Also walk the archive. Off by default: on a Gmail account the archive is
   * All Mail, so this enumerates the entire mailbox and fetches a body per
   * travel-looking message in it. Opt in knowingly.
   */
  includeArchive?: boolean;
}

interface TripScanHit {
  id: number;
  author: string;
  subject: string;
  date: string;
  jsonLdTypes: string[];
  microdataTypes: string[];
  reservations: unknown[];
  /** First chunk of each text/calendar part or .ics attachment, if any. */
  icsSnippets: string[];
}

interface TripScanReport {
  scannedHeaders: number;
  candidates: number;
  fetched: number;
  fetchFailed: number;
  withJsonLd: number;
  withMicrodata: number;
  withIcs: number;
  withAnyMarkup: number;
  /** Reservation @type → count of messages containing it. */
  types: Record<string, number>;
  /** Sender domain → candidates seen / candidates with structured data. */
  domains: Record<string, { candidates: number; withMarkup: number; withIcs: number }>;
  hits: TripScanHit[];
}

const RESERVATION_TYPE_RE =
  /^(Flight|Lodging|Train|Bus|RentalCar|Taxi|Event|FoodEstablishment)?Reservation(Package)?$/;

const LD_JSON_RE =
  /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

const MICRODATA_RE =
  /itemtype\s*=\s*["']https?:\/\/schema\.org\/((?:Flight|Lodging|Train|Bus|RentalCar|Taxi|Event|FoodEstablishment)?Reservation(?:Package)?)["']/gi;

/** Broad net so we also catch travel mail the classifier's rule misses. */
const CANDIDATE_SUBJECT_RE =
  /\b(flight|itinerary|booking|reservation|check[- ]?in|confirmation|boarding|e[- ]?ticket|hotel|rental|amtrak)\b/i;

type Part = messenger.messages.MessagePart;

const ICS_SNIPPET_CHARS = 800;

const collectBodies = (part: Part, out: string[], ics: string[]): void => {
  const ct = (part.contentType ?? "").toLowerCase();
  const isIcs =
    ct.startsWith("text/calendar") ||
    ct.startsWith("application/ics") ||
    (part.name ?? "").toLowerCase().endsWith(".ics");
  if (isIcs) {
    // Attachment bodies aren't included by getFull; record presence regardless.
    ics.push((part.body ?? "(attachment; body not inline)").slice(0, ICS_SNIPPET_CHARS));
  } else if (part.body && (ct.startsWith("text/html") || ct.startsWith("text/plain"))) {
    out.push(part.body);
  }
  for (const sub of part.parts ?? []) collectBodies(sub, out, ics);
}

/** JSON-LD blocks may hold a single node, an array, or a @graph wrapper. */
const flattenLdNodes = (parsed: unknown): Record<string, unknown>[] => {
  if (Array.isArray(parsed)) return parsed.flatMap(flattenLdNodes);
  if (parsed && typeof parsed === "object") {
    const node = parsed as Record<string, unknown>;
    const graph = node["@graph"];
    if (Array.isArray(graph)) return graph.flatMap(flattenLdNodes);
    return [node];
  }
  return [];
}

const typesOf = (node: Record<string, unknown>): string[] => {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

const inspectBodies = (
  bodies: string[],
): { jsonLdTypes: string[]; microdataTypes: string[]; reservations: unknown[] } => {
  const jsonLdTypes = new Set<string>();
  const microdataTypes = new Set<string>();
  const reservations: unknown[] = [];
  for (const body of bodies) {
    for (const match of body.matchAll(LD_JSON_RE)) {
      if (match[1] === undefined) continue;
      try {
        const nodes = flattenLdNodes(JSON.parse(match[1]));
        for (const node of nodes) {
          for (const t of typesOf(node)) {
            if (RESERVATION_TYPE_RE.test(t)) {
              jsonLdTypes.add(t);
              reservations.push(node);
            }
          }
        }
      } catch {
        /* malformed or truncated JSON-LD; skip the block */
      }
    }
    for (const match of body.matchAll(MICRODATA_RE)) {
      if (match[1] !== undefined) microdataTypes.add(match[1]);
    }
  }
  return {
    jsonLdTypes: [...jsonLdTypes],
    microdataTypes: [...microdataTypes],
    reservations,
  };
}

type Page = { id?: string | null; messages?: messenger.messages.MessageHeader[] };

async function* iterateFolder(
  folderId: string,
  fromDate?: number,
): AsyncGenerator<messenger.messages.MessageHeader> {
  const fid = folderId as unknown as messenger.folders.MailFolderId;
  let page: Page =
    fromDate === undefined
      ? await messenger.messages.list(fid)
      : ((await messenger.messages.query({
          folderId: fid,
          fromDate: new Date(fromDate),
        })) as Page);
  while (true) {
    for (const header of page.messages ?? []) yield header;
    if (!page.id) return;
    page = await messenger.messages.continueList(page.id);
  }
}

const isCandidate = (header: messenger.messages.MessageHeader): boolean => {
  const features = extractFeatures(header, {});
  if (matchesTravel(features)) return true;
  return CANDIDATE_SUBJECT_RE.test(header.subject ?? "");
}

export const scanTripMarkup = async (
  options: TripScanOptions = {},
): Promise<TripScanReport> => {
  const fromDate =
    options.fromDate === undefined ? undefined : new Date(options.fromDate).getTime();
  const report: TripScanReport = {
    scannedHeaders: 0,
    candidates: 0,
    fetched: 0,
    fetchFailed: 0,
    withJsonLd: 0,
    withMicrodata: 0,
    withIcs: 0,
    withAnyMarkup: 0,
    types: {},
    domains: {},
    hits: [],
  };

  const folders = [
    ...(await collectInboxFolders()),
    ...(options.includeArchive ? await collectArchiveFolders() : []),
  ];
  const seen = new Set<string>();

  scan: for (const folder of folders) {
    log.info("trip-scan", `scanning folder: ${folder.name}`);
    for await (const header of iterateFolder(folder.id, fromDate)) {
      report.scannedHeaders++;
      if (report.scannedHeaders % 500 === 0) {
        log.info("trip-scan", `…${report.scannedHeaders} headers, ${report.candidates} candidates, ${report.withAnyMarkup} with markup`);
      }
      // Gmail's All Mail duplicates inbox messages; count each mail once.
      const dedupeKey = header.headerMessageId ?? `${header.id}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      if (!options.everything && !isCandidate(header)) continue;
      report.candidates++;
      if (options.max !== undefined && report.candidates > options.max) break scan;

      const domain = parseSender(header.author ?? "").domain || "(unknown)";
      const domainStats = (report.domains[domain] ??= {
        candidates: 0,
        withMarkup: 0,
        withIcs: 0,
      });
      domainStats.candidates++;

      const bodies: string[] = [];
      const icsSnippets: string[] = [];
      try {
        const full = await messenger.messages.getFull(header.id);
        collectBodies(full as Part, bodies, icsSnippets);
        report.fetched++;
      } catch {
        report.fetchFailed++;
        continue;
      }

      const { jsonLdTypes, microdataTypes, reservations } = inspectBodies(bodies);
      if (jsonLdTypes.length) report.withJsonLd++;
      if (microdataTypes.length) report.withMicrodata++;
      if (icsSnippets.length) {
        report.withIcs++;
        domainStats.withIcs++;
      }
      if (!jsonLdTypes.length && !microdataTypes.length && !icsSnippets.length) continue;

      if (jsonLdTypes.length || microdataTypes.length) {
        report.withAnyMarkup++;
        domainStats.withMarkup++;
      }
      for (const t of new Set([...jsonLdTypes, ...microdataTypes])) {
        report.types[t] = (report.types[t] ?? 0) + 1;
      }
      report.hits.push({
        id: header.id,
        author: header.author ?? "",
        subject: header.subject ?? "",
        date: header.date ? new Date(header.date).toISOString().slice(0, 10) : "",
        jsonLdTypes,
        microdataTypes,
        reservations,
        icsSnippets,
      });
    }
  }

  (globalThis as Record<string, unknown>).neoTripScanLast = report;

  const pct = (n: number): string =>
    report.candidates ? `${((100 * n) / report.candidates).toFixed(1)}%` : "n/a";
  console.log(
    `[trip-scan] ${report.scannedHeaders} headers scanned, ${report.candidates} travel candidates\n` +
      `  with JSON-LD reservation markup:   ${report.withJsonLd} (${pct(report.withJsonLd)})\n` +
      `  with microdata reservation markup: ${report.withMicrodata} (${pct(report.withMicrodata)})\n` +
      `  with schema.org markup (either):   ${report.withAnyMarkup} (${pct(report.withAnyMarkup)})\n` +
      `  with calendar part / .ics:         ${report.withIcs} (${pct(report.withIcs)})\n` +
      `  getFull failures (body not local): ${report.fetchFailed}`,
  );
  console.table(report.types);
  console.table(report.domains);
  console.log("[trip-scan] full details (incl. parsed reservations): neoTripScanLast");

  return report;
}

export const installTripScan = (): void => {
  (globalThis as Record<string, unknown>).neoTripScan = scanTripMarkup;
}

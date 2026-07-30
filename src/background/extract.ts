/**
 * Reservation extraction + auto-clustering pipeline (trip bundles phase 2/3).
 *
 * Sweep: travel-looking messages get their body fetched once per
 * EXTRACTOR_VERSION, run through the extractor registry, and the result —
 * including "nothing found", and any confirmation codes spotted either way —
 * stored as a ReservationRecord keyed by Message-ID. Cluster: the pure
 * clusterer turns those records into trips/memberships, the diff is
 * persisted, and the SPA hears about it via a trips-delta broadcast.
 *
 * Automatic sweeps (startup, periodic sync, new mail) only look at mail
 * currently in the inbox: archived rows are where stale ids and unsynced
 * bodies live, and retrying those on every startup burned real CPU with
 * nothing visible to show for it. The archive backlog is opt-in via the
 * console harness instead.
 *
 * Debug harness (background console):
 *   await neoTripExtract()                 // full sweep incl. archive, report
 *   await neoTripExtract({ force: true })  // drop records, re-extract all
 * Full details stay at globalThis.neoTripExtractLast — per-domain hit rates
 * and text snippets of the misses, for tuning the per-sender parsers.
 */
import { EXTRACTOR_VERSION, hasSenderExtractor, runExtractors } from "../classifier/extractors";
import { findAirports, findFlights } from "../classifier/extractors/flights";
import { findConfirmationCodes, findDates, htmlToText } from "../classifier/extractors/text";
import { withTimeout } from "./backfill";
import { broadcast } from "./port";
import { resolveLiveMessageId } from "../shared/liveMessage";
import { log } from "../shared/log";
import { pinKeyOf } from "../shared/pinKey";
import { parseSender } from "../shared/senders";
import { clusterTrips } from "../shared/tripCluster";
import type {
  RawMessage,
  ReservationRecord,
  TripMembershipRecord,
  TripRecord,
} from "../shared/types";
import { db } from "../store/db";

/** Broad net, mirroring the diagnostic scan: parsers see more than the classifier. */
const CANDIDATE_SUBJECT_RE =
  /\b(flight|itinerary|booking|reservation|check[- ]?in|confirmation|boarding|e[- ]?ticket|hotel|rental|amtrak)\b/i;

const SWEEP_LIMIT = 800;
/** Automatic sweeps breathe between body fetches so startup stays smooth. */
const SWEEP_PACE_MS = 50;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const isTripCandidate = (m: RawMessage, includeDone = false): boolean => {
  if (m.origin !== "inbox" && !(includeDone && m.origin === "done")) return false;
  if (m.category === "travel") return true;
  const domain = parseSender(m.author).domain;
  if (domain && hasSenderExtractor(domain)) return true;
  return CANDIDATE_SUBJECT_RE.test(m.subject);
};

type Part = messenger.messages.MessagePart;

const collectBodies = (part: Part, text: string[], html: string[]): void => {
  const ct = (part.contentType ?? "").toLowerCase();
  if (part.body) {
    if (ct.startsWith("text/html")) html.push(part.body);
    else if (ct.startsWith("text/plain")) text.push(part.body);
  }
  for (const sub of part.parts ?? []) collectBodies(sub, text, html);
};

export interface TripExtractMiss {
  /** TB message id — feed to neoTripDebug(id) for a full parse breakdown. */
  id: number;
  domain: string;
  subject: string;
  date: string;
  snippet: string;
}

export interface TripExtractReport {
  candidates: number;
  fetched: number;
  fetchFailed: number;
  extracted: number;
  cancelled: number;
  none: number;
  domains: Record<string, { tried: number; extracted: number }>;
  misses: TripExtractMiss[];
  trips: { name: string; start?: string; end?: string; members: number }[];
}

const MISS_SNIPPET_CHARS = 600;
const MISS_LIMIT = 40;

interface SweepOptions {
  force?: boolean;
  max?: number;
  /**
   * Also sweep archived ("done") mail — harness runs only. Done rows are the
   * expensive ones: stale ids mean per-message Message-ID queries, and bodies
   * IMAP never synced fail getFull and would retry forever.
   */
  includeDone?: boolean;
  report?: TripExtractReport;
}

let sweeping = false;

const sweepReservations = async (options: SweepOptions = {}): Promise<number> => {
  const { force = false, max = SWEEP_LIMIT, includeDone = false, report } = options;
  if (force) await db.reservations.clear();

  const existing = new Map(
    (await db.reservations.toArray()).map((r) => [r.key, r] as const),
  );
  // Inbox and archive copies of one message share a pinKey; scan the newest.
  const byKey = new Map<string, RawMessage>();
  for (const m of await db.messages.toArray()) {
    if (!isTripCandidate(m, includeDone)) continue;
    const key = pinKeyOf(m);
    const prev = byKey.get(key);
    if (!prev || m.date > prev.date) byKey.set(key, m);
  }

  let scanned = 0;
  let wrote = 0;
  for (const [key, m] of byKey) {
    if (scanned >= max) break;
    const prior = existing.get(key);
    if (prior && prior.extractorVersion >= EXTRACTOR_VERSION) continue;
    scanned++;

    const domain = parseSender(m.author).domain || "(unknown)";
    if (report) {
      report.candidates++;
      (report.domains[domain] ??= { tried: 0, extracted: 0 }).tried++;
    }

    const record: ReservationRecord = {
      key,
      messageDate: m.date,
      senderDomain: domain,
      extractorVersion: EXTRACTOR_VERSION,
      extractor: "",
      status: "none",
      segments: [],
      confirmationCodes: [],
      scannedAt: Date.now(),
    };

    try {
      // Done rows can carry stale numeric ids; never parse a body that might
      // belong to a different message.
      const liveId = await withTimeout(resolveLiveMessageId(m), `resolve ${m.id}`);
      if (liveId === null) {
        await db.reservations.put(record);
        continue;
      }
      const full = await withTimeout(
        messenger.messages.getFull(liveId),
        `getFull ${liveId}`,
      );
      const textParts: string[] = [];
      const htmlParts: string[] = [];
      collectBodies(full as Part, textParts, htmlParts);
      const html = htmlParts.join("\n");
      const text = [...textParts, htmlToText(html)].join("\n");
      if (report) report.fetched++;

      const sender = parseSender(m.author);
      const hit = runExtractors({
        senderEmail: sender.email,
        senderDomain: sender.domain,
        subject: m.subject,
        messageDate: m.date,
        text,
        html,
      });
      if (hit) {
        record.extractor = hit.extractor;
        record.status = hit.cancelled ? "cancelled" : "extracted";
        record.segments = hit.segments;
        record.confirmationCodes = hit.confirmationCodes;
      } else {
        // No reservation here, but any codes still matter: a check-in
        // reminder or receipt quoting a known locator joins that trip.
        record.confirmationCodes = findConfirmationCodes(text);
      }
      if (report) {
        if (record.status === "none") {
          report.none++;
          if (report.misses.length < MISS_LIMIT) {
            report.misses.push({
              id: m.id,
              domain,
              subject: m.subject,
              date: new Date(m.date).toISOString().slice(0, 10),
              snippet: text.slice(0, MISS_SNIPPET_CHARS),
            });
          }
        } else {
          report.domains[domain]!.extracted++;
          if (record.status === "cancelled") report.cancelled++;
          else report.extracted++;
        }
      }
    } catch (e) {
      if (report) report.fetchFailed++;
      log.debug("trip-extract", "sweep skipped a message", { id: m.id, e: String(e) });
      continue; // no record: body may sync later, retry next sweep
    }
    await db.reservations.put(record);
    wrote++;
    // Interactive harness runs skip the pacing; background sweeps spread the
    // body fetches out instead of spiking CPU right at startup.
    if (!report) await sleep(SWEEP_PACE_MS);
  }
  if (wrote) log.info("trip-extract", `sweep scanned ${scanned}, wrote ${wrote} reservation records`);
  return wrote;
};

/**
 * Recluster from the stored reservations and persist the diff. Reads trips
 * and memberships fresh so a manual assignment the SPA just saved always
 * wins; only auto rows are ever written or deleted here.
 */
const recluster = async (report?: TripExtractReport): Promise<void> => {
  const [reservations, trips, memberships] = await Promise.all([
    db.reservations.toArray(),
    db.trips.toArray(),
    db.tripMemberships.toArray(),
  ]);
  const tripsById: Record<string, TripRecord> = {};
  for (const t of trips) tripsById[t.id] = t;
  const membershipByKey: Record<string, TripMembershipRecord> = {};
  for (const m of memberships) membershipByKey[m.key] = m;

  // Pass every record, even "nothing found, no codes": those keys must stay
  // visible to the stale-row cleanup, or a membership written under an older
  // extractor version survives forever once its message stops qualifying
  // (that's how round-1 blob trips kept 240 ghost members).
  const result = clusterTrips({
    reservations,
    tripsById,
    membershipByKey,
    now: Date.now(),
  });

  if (report) {
    const memberCounts = new Map<string, number>();
    const nextMemberships = { ...membershipByKey };
    for (const key of result.membershipKeysToDelete) delete nextMemberships[key];
    for (const m of result.membershipsToPut) nextMemberships[m.key] = m;
    for (const m of Object.values(nextMemberships)) {
      if (m.tripId) memberCounts.set(m.tripId, (memberCounts.get(m.tripId) ?? 0) + 1);
    }
    const nextTrips = { ...tripsById };
    for (const id of result.tripIdsToDelete) delete nextTrips[id];
    for (const t of result.tripsToPut) nextTrips[t.id] = t;
    report.trips = Object.values(nextTrips).map((t) => ({
      name: t.name,
      start: t.startDate ? new Date(t.startDate).toISOString().slice(0, 10) : undefined,
      end: t.endDate ? new Date(t.endDate).toISOString().slice(0, 10) : undefined,
      members: memberCounts.get(t.id) ?? 0,
    }));
  }

  if (
    !result.tripsToPut.length &&
    !result.tripIdsToDelete.length &&
    !result.membershipsToPut.length &&
    !result.membershipKeysToDelete.length
  ) {
    return;
  }

  // Guard the write: a manual row saved between our read and this write must
  // survive, so drop any auto write that now collides with a manual row.
  await db.transaction("rw", db.trips, db.tripMemberships, async () => {
    const safe: TripMembershipRecord[] = [];
    for (const m of result.membershipsToPut) {
      const current = await db.tripMemberships.get(m.key);
      if (current?.source === "manual") continue;
      safe.push(m);
    }
    result.membershipsToPut = safe;
    if (result.tripsToPut.length) await db.trips.bulkPut(result.tripsToPut);
    if (result.tripIdsToDelete.length) await db.trips.bulkDelete(result.tripIdsToDelete);
    if (safe.length) await db.tripMemberships.bulkPut(safe);
    if (result.membershipKeysToDelete.length) {
      await db.tripMemberships.bulkDelete(result.membershipKeysToDelete);
    }
  });

  broadcast({
    type: "trips-delta",
    trips: result.tripsToPut,
    removedTripIds: result.tripIdsToDelete,
    memberships: result.membershipsToPut,
    removedMembershipKeys: result.membershipKeysToDelete,
  });
  log.info("trip-extract", "recluster applied", {
    trips: result.tripsToPut.length,
    removedTrips: result.tripIdsToDelete.length,
    memberships: result.membershipsToPut.length,
    removed: result.membershipKeysToDelete.length,
  });
};

export const runTripExtraction = async (options: SweepOptions = {}): Promise<void> => {
  if (sweeping) return;
  sweeping = true;
  try {
    const wrote = await sweepReservations(options);
    // Reclustering is cheap but not free; skip when the sweep found nothing
    // new (unless a report wants the current cluster picture regardless).
    if (wrote || options.report || options.force) await recluster(options.report);
  } catch (e) {
    log.warn("trip-extract", "extraction run failed", e);
  } finally {
    sweeping = false;
  }
};

let scheduleTimer: ReturnType<typeof setTimeout> | undefined;

/** Debounced trigger for after scans / new travel mail. */
export const scheduleTripExtraction = (): void => {
  clearTimeout(scheduleTimer);
  scheduleTimer = setTimeout(() => {
    void runTripExtraction();
  }, 3_000);
};

export const installTripExtract = (): void => {
  (globalThis as Record<string, unknown>).neoTripExtract = async (
    options: { force?: boolean; max?: number } = {},
  ): Promise<TripExtractReport> => {
    const report: TripExtractReport = {
      candidates: 0,
      fetched: 0,
      fetchFailed: 0,
      extracted: 0,
      cancelled: 0,
      none: 0,
      domains: {},
      misses: [],
      trips: [],
    };
    await runTripExtraction({
      ...options,
      max: options.max ?? Infinity,
      includeDone: true,
      report,
    });
    (globalThis as Record<string, unknown>).neoTripExtractLast = report;
    console.log(
      `[trip-extract] ${report.candidates} candidates swept this run\n` +
        `  extracted: ${report.extracted}  cancelled: ${report.cancelled}  nothing found: ${report.none}\n` +
        `  fetch failures: ${report.fetchFailed}\n` +
        `  (already-scanned messages are skipped; use {force:true} to redo all)`,
    );
    console.table(report.domains);
    console.table(report.trips);
    console.log("[trip-extract] misses w/ text snippets: neoTripExtractLast.misses");
    return report;
  };

  // Per-message parse breakdown: which atoms (dates, codes, airports, flight
  // numbers, JSON-LD blocks) the extractors saw and what they concluded.
  // Take the id from neoTripExtractLast.misses[n].id.
  (globalThis as Record<string, unknown>).neoTripDebug = async (
    id: number,
  ): Promise<unknown> => {
    const header = await messenger.messages.get(id);
    const full = await messenger.messages.getFull(id);
    const textParts: string[] = [];
    const htmlParts: string[] = [];
    collectBodies(full as Part, textParts, htmlParts);
    const html = htmlParts.join("\n");
    const text = [...textParts, htmlToText(html)].join("\n");
    const sender = parseSender(header.author ?? "");
    const messageDate = header.date ? new Date(header.date).getTime() : Date.now();
    const input = {
      senderEmail: sender.email,
      senderDomain: sender.domain,
      subject: header.subject ?? "",
      messageDate,
      text,
      html,
    };
    const out = {
      subject: input.subject,
      domain: sender.domain,
      date: new Date(messageDate).toISOString(),
      jsonLdBlocks: (html.match(/application\/ld\+json/gi) ?? []).length,
      dates: findDates(text, messageDate).map((f) => ({
        date: new Date(f.date).toISOString().slice(0, 10),
        around: text.slice(Math.max(0, f.index - 40), f.index + 40).replace(/\n/g, "⏎"),
      })),
      codes: findConfirmationCodes(text),
      airports: findAirports(text).map((a) => a.value),
      flightTokens: findFlights(text, []).map((f) => f.value),
      result: runExtractors(input),
      text: text.slice(0, 4000),
    };
    console.log(JSON.stringify({ ...out, text: undefined }, null, 2));
    console.log("[trip-debug] full text at neoTripDebugLast.text");
    (globalThis as Record<string, unknown>).neoTripDebugLast = out;
    return out;
  };
};

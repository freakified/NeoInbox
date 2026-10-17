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
 *   await neoTripExtract({ reset: true })  // also delete auto trips first:
 *                                          // rebuild from scratch, keeping
 *                                          // manual trips/memberships
 *   await neoTripExtract({ reset: "all" }) // …and delete manual ones too
 * Full details stay at globalThis.neoTripExtractLast — per-domain hit rates
 * and text snippets of the misses, for tuning the per-sender parsers.
 */
import { EXTRACTOR_VERSION, hasSenderExtractor, runExtractors } from "../classifier/extractors";
import { extractFeatures } from "../classifier/features";
import { matchesTravel } from "../classifier/rules/travel";
import { findLegs, findFlights } from "../classifier/extractors/flights";
import { findConfirmationCodes, findDates } from "../classifier/extractors/text";
import { buildExtractorInput } from "../classifier/samples";
import { withTimeout } from "./scanQueue";
import { broadcast } from "./port";
import { resolveLiveMessageId } from "../shared/liveMessage";
import { log } from "../shared/log";
import { pinKeyOf } from "../shared/pinKey";
import { parseSender } from "../shared/senders";
import { clusterTrips } from "../shared/tripCluster";
import type { TripScanStatus, TripWrite } from "../shared/messaging";
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

/**
 * Candidacy is computed from the message itself, never from its stored
 * category. Reading `category === "travel"` here used to mean a route rule
 * ("send amtrak to Updates") could delete the signal that got a booking's body
 * scanned at all, so a user's bundle preference silently disabled trip
 * detection for that sender. Trips are evaluated independently of routing.
 */
export const isTripCandidate = (m: RawMessage, includeDone = false): boolean => {
  if (m.origin !== "inbox" && !(includeDone && m.origin === "done")) return false;
  if (matchesTravel(extractFeatures(m, {}))) return true;
  const domain = parseSender(m.author).domain;
  if (domain && hasSenderExtractor(domain)) return true;
  return CANDIDATE_SUBJECT_RE.test(m.subject);
};

export type Part = messenger.messages.MessagePart;

export const collectBodies = (part: Part, text: string[], html: string[]): void => {
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
  /** Called after each message with (handled so far, total to handle). */
  onProgress?: (processed: number, total: number) => void;
  /** Polled between messages; true stops the sweep (records so far are kept). */
  shouldStop?: () => boolean;
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

  const todo = [...byKey].filter(([key]) => {
    const prior = existing.get(key);
    return !prior || prior.extractorVersion < EXTRACTOR_VERSION;
  });
  const total = Math.min(todo.length, max);
  options.onProgress?.(0, total);

  let scanned = 0;
  let wrote = 0;
  for (const [key, m] of todo) {
    if (scanned >= max || options.shouldStop?.()) break;
    scanned++;
    if (scanned > 1) options.onProgress?.(scanned - 1, total);

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
      const input = buildExtractorInput({ ...m, textParts, htmlParts });
      const { text } = input;
      if (report) report.fetched++;

      const hit = runExtractors(input);
      if (hit) {
        record.extractor = hit.extractor;
        record.status = hit.cancelled ? "cancelled" : "extracted";
        record.segments = hit.segments;
        record.confirmationCodes = hit.confirmationCodes;
      } else {
        // No reservation here, but any codes still matter: a check-in
        // reminder or receipt quoting a known locator joins that trip.
        record.confirmationCodes = findConfirmationCodes(text, input.subject);
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
  options.onProgress?.(scanned, total);
  if (wrote) log.info("trip-extract", `sweep scanned ${scanned}, wrote ${wrote} reservation records`);
  return wrote;
};

/**
 * Recluster from the stored reservations and persist the diff. Reads trips
 * and memberships fresh so a manual assignment the SPA just saved always
 * wins; only auto rows are ever written or deleted here.
 */
/**
 * Every write to trips and tripMemberships runs through this queue, one at a
 * time: the clusterer's read-compute-write, a reset, and the SPA's edits. A
 * manual edit landing in the middle of a recluster would otherwise be judged
 * against a picture the clusterer read before it.
 */
let tripWrites: Promise<unknown> = Promise.resolve();
const withTripWrites = <T>(work: () => Promise<T>): Promise<T> => {
  const run = tripWrites.then(work, work);
  tripWrites = run.catch(() => undefined);
  return run;
};

/** Apply an SPA trip edit and echo what landed to every open tab. */
export const writeTrips = (change: TripWrite): Promise<void> =>
  withTripWrites(async () => {
    const kept: TripRecord[] = [];
    const deleted: string[] = [];
    await db.transaction("rw", db.trips, db.tripMemberships, async () => {
      if (change.trips.length) await db.trips.bulkPut(change.trips);
      if (change.memberships.length) await db.tripMemberships.bulkPut(change.memberships);
      if (change.deleteMembershipKeys.length) {
        await db.tripMemberships.bulkDelete(change.deleteMembershipKeys);
      }
      for (const id of change.deleteTripIds) {
        // The SPA judged this trip empty from its own copy; an auto membership
        // the clusterer wrote since then says otherwise, and keeps it.
        if (await db.tripMemberships.where("tripId").equals(id).count()) {
          const trip = await db.trips.get(id);
          if (trip) kept.push(trip);
          continue;
        }
        await db.trips.delete(id);
        deleted.push(id);
      }
    });
    broadcast({
      type: "trips-delta",
      authoritative: true,
      trips: [...change.trips, ...kept],
      removedTripIds: deleted,
      memberships: change.memberships,
      removedMembershipKeys: change.deleteMembershipKeys,
    });
  });

const recluster = (report?: TripExtractReport): Promise<void> =>
  withTripWrites(() => reclusterNow(report));

const reclusterNow = async (report?: TripExtractReport): Promise<void> => {
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
    authoritative: false,
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

/**
 * Clean slate for the clusterer. "auto" deletes every auto membership and
 * every trip no manual membership points at (manual rows, "remove from trip"
 * tombstones and the trips they name survive); "all" deletes everything.
 */
const resetTrips = (mode: "auto" | "all"): Promise<void> =>
  withTripWrites(() => resetTripsNow(mode));

const resetTripsNow = async (mode: "auto" | "all"): Promise<void> => {
  const memberships = await db.tripMemberships.toArray();
  const doomedMemberships = memberships.filter((m) => mode === "all" || m.source === "auto");
  const keptTripIds = new Set(
    memberships.filter((m) => !doomedMemberships.includes(m) && m.tripId).map((m) => m.tripId!),
  );
  const doomedTrips = (await db.trips.toArray()).filter((t) => !keptTripIds.has(t.id));
  await db.transaction("rw", db.trips, db.tripMemberships, async () => {
    await db.tripMemberships.bulkDelete(doomedMemberships.map((m) => m.key));
    await db.trips.bulkDelete(doomedTrips.map((t) => t.id));
  });
  broadcast({
    type: "trips-delta",
    // "all" removes manual rows too, which the SPA must not keep.
    authoritative: mode === "all",
    trips: [],
    removedTripIds: doomedTrips.map((t) => t.id),
    memberships: [],
    removedMembershipKeys: doomedMemberships.map((m) => m.key),
  });
  log.info("trip-extract", "trips reset", {
    mode,
    trips: doomedTrips.length,
    memberships: doomedMemberships.length,
  });
};

export const runTripExtraction = async (
  options: SweepOptions & { reset?: "auto" | "all" } = {},
): Promise<void> => {
  if (sweeping) return;
  sweeping = true;
  try {
    if (options.reset) {
      await resetTrips(options.reset);
      options = { ...options, force: true };
    }
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

// ─── user-started scans (Settings → Trips) ─────────────────────────────────

/** The last finished archive scan; Settings shows it and Rebuild honors it. */
const ARCHIVE_SCAN_KEY = "tripArchiveScan";
const PROGRESS_EVERY_MS = 750;

let scanStatus: TripScanStatus | null = null;
let stopRequested = false;

const publish = async (status: TripScanStatus): Promise<void> => {
  const archiveScannedAt = (await getLastArchiveScan())?.finishedAt;
  scanStatus = { ...status, archiveScannedAt };
  broadcast({ type: "trip-scan-progress", ...scanStatus });
};

/** The last finished archive scan, if the user ever ran one. */
export const getLastArchiveScan = async (): Promise<TripScanStatus | null> => {
  const stored = await messenger.storage.local.get(ARCHIVE_SCAN_KEY);
  return (stored[ARCHIVE_SCAN_KEY] as TripScanStatus | undefined) ?? null;
};

/** The running or latest scan this session, else the last archive scan. */
export const getTripScanStatus = async (): Promise<TripScanStatus | null> => {
  if (scanStatus) return scanStatus;
  const last = await getLastArchiveScan();
  return last && { ...last, archiveScannedAt: last.finishedAt };
};

export const cancelTripScan = (): void => {
  stopRequested = true;
};

/**
 * Find trips in archived mail too (`archive`) — opt-in from Settings, since
 * it reads the body of every travel-looking message NeoInbox has cached,
 * which can be thousands. Already-read messages are skipped, so a stopped
 * or interrupted scan picks up where it left off. `rebuild` first deletes
 * the auto-built trips and re-reads everything (manual edits survive).
 */
export const runTripScan = async ({ archive, rebuild = false }: { archive: boolean; rebuild?: boolean }): Promise<void> => {
  if (scanStatus?.running) return;
  stopRequested = false;
  await publish({ running: true, archive, rebuild, processed: 0, total: 0 });
  // An automatic inbox sweep may hold the lock; it's short, so wait it out.
  while (sweeping) await sleep(500);
  sweeping = true;
  let last = 0;
  let processed = 0;
  let total = 0;
  try {
    if (rebuild) await resetTrips("auto");
    await sweepReservations({
      force: rebuild,
      max: Infinity,
      includeDone: archive,
      shouldStop: () => stopRequested,
      onProgress: (done, all) => {
        processed = done;
        total = all;
        if (Date.now() - last < PROGRESS_EVERY_MS && done < all) return;
        last = Date.now();
        void publish({ running: true, archive, rebuild, processed, total });
      },
    });
    await recluster();
    const finished: TripScanStatus = {
      running: false,
      archive,
      rebuild,
      processed,
      total,
      trips: await db.trips.count(),
      finishedAt: Date.now(),
      cancelled: stopRequested || undefined,
    };
    if (archive) await messenger.storage.local.set({ [ARCHIVE_SCAN_KEY]: finished });
    await publish(finished);
  } catch (e) {
    log.warn("trip-extract", "trip scan failed", e);
    await publish({ running: false, archive, rebuild, processed, total, error: String(e) });
  } finally {
    sweeping = false;
  }
};

export const installTripExtract = (): void => {
  (globalThis as Record<string, unknown>).neoTripExtract = async (
    options: { force?: boolean; max?: number; reset?: boolean | "auto" | "all" } = {},
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
    const reset = options.reset === true ? "auto" : options.reset || undefined;
    await runTripExtraction({
      ...options,
      reset,
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
    const messageDate = header.date ? new Date(header.date).getTime() : Date.now();
    const input = buildExtractorInput({
      author: header.author ?? "",
      subject: header.subject ?? "",
      date: messageDate,
      textParts,
      htmlParts,
    });
    const { text, html, senderDomain } = input;
    const out = {
      subject: input.subject,
      domain: senderDomain,
      date: new Date(messageDate).toISOString(),
      jsonLdBlocks: (html.match(/application\/ld\+json/gi) ?? []).length,
      dates: findDates(text, messageDate).map((f) => ({
        date: new Date(f.date).toISOString().slice(0, 10),
        around: text.slice(Math.max(0, f.index - 40), f.index + 40).replace(/\n/g, "⏎"),
      })),
      codes: findConfirmationCodes(text, input.subject),
      legs: findLegs(input.lines, messageDate, [], input.subject).map(
        (l) => `${new Date(l.date).toISOString().slice(0, 10)} ${l.origin}→${l.destination} (${l.form}, +${l.distance})`,
      ),
      lines: input.lines.slice(0, 200).map((l) => `t${l.table} ${l.text}`),
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

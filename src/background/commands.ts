/**
 * Handlers for every command the SPA sends over the port.
 *
 * Split out of index.ts so the command layer can be driven directly in tests:
 * index.ts is wiring with top-level side effects (alarms, listeners, sweeps)
 * and cannot be imported without a live Thunderbird.
 */
import {
  applyMessageDetails,
  classifyFromHeader,
  classifyMessage,
  doneMessage,
  getLiveHeader,
  isHeaderOnly,
  loadMessageBody,
  opTbId,
  pinMessage,
  spamMessage,
  trashMessage,
} from "./ingest";
import { type ArchivedCopy, findByHeaderMessageIdInFolder } from "./archiveFolders";
import { applyClassification, carryClassification } from "../classifier/version";
import { headerToRawMessage } from "./messageMap";
import { snoozeMessage, wakeSnoozedMessage } from "./snooze";
import { runBackfill } from "./backfill";
import { hydrateDetails } from "./detailsFill";
import { getLastProgress, serialized } from "./scanQueue";
import { scanActive } from "./scanGuard";
import { runCompose } from "./compose";
import { cancelArchiveImport, getArchiveImportStatus } from "./archiveImport";
import { getInboxImportStatus } from "./inboxImport";
import { startArchiveImport, startArchiveTripScan } from "./archiveJob";
import {
  cancelTripScan,
  getTripScanStatus,
  runTripScan,
  scheduleTripExtraction,
  writeTrips,
} from "./extract";
import { extractFeatures } from "../classifier/features";
import { matchesTravel } from "../classifier/rules/travel";
import { setTripsEnabled } from "../shared/tripsSetting";
import { pushMyEmails } from "./sync";
import { applyLocalState, clearResurfaced } from "./localState";
import { messageKeyOf, type MessageKey } from "../shared/messageKey";
import { pinKeyOf } from "../shared/pinKey";
import { broadcast } from "./port";
import { invalidateRouteRules } from "../classifier/routeRules";
import { db } from "../store/db";
import { liveTbId } from "../shared/liveMessage";
import { collectInboxFolders } from "../shared/folders";
import { ruleMatchesMessage } from "../shared/routeRules";
import { log } from "../shared/log";
import type { ClientMsg } from "../shared/messaging";
import type { RawMessage, RouteRuleRecord } from "../shared/types";

/**
 * Re-run the full classify pipeline for these cached inbox messages, persist
 * the results, and broadcast one delta. Returns how many changed category.
 */
const reclassifyMessages = async (cached: RawMessage[]): Promise<{ scanned: number; moved: number }> => {
  const updated: RawMessage[] = [];
  const readded: RawMessage[] = [];
  const removedKeys: MessageKey[] = [];
  let moved = 0;
  for (const cmsg of cached) {
    try {
      const header = await getLiveHeader(cmsg);
      if (!header) {
        log.debug("reclassify", "message no longer resolvable; skipped", { key: cmsg.key });
        continue;
      }
      const raw = headerToRawMessage(header, "inbox");
      // Older inbox mail cached from headers stays that way: a rule can match
      // thousands of those rows, and each body would be a download.
      const headerOnly = isHeaderOnly(cmsg);
      const body = headerOnly ? undefined : await loadMessageBody(header.id);
      applyClassification(
        raw,
        headerOnly ? await classifyFromHeader(header) : await classifyMessage(header, body),
      );
      await applyLocalState(raw);
      await applyMessageDetails(raw, cmsg, body);
      // The live copy can sit in another folder than the row said.
      if (raw.key === cmsg.key) {
        updated.push(raw);
      } else {
        await db.messages.delete(cmsg.key);
        removedKeys.push(cmsg.key);
        readded.push(raw);
      }
      await db.messages.put(raw);
      if ((raw.category ?? null) !== (cmsg.category ?? null)) moved++;
    } catch (e) {
      log.warn("reclassify", "failed", { key: cmsg.key, e });
    }
  }
  // One combined delta: re-keyed rows must land before the old key is dropped
  // or the row would blink out of the stream in between.
  if (updated.length || readded.length || removedKeys.length) {
    broadcast({ type: "delta", updated, added: readded, removedKeys });
  }
  return { scanned: cached.length, moved };
}

const RULE_SWEEP_SETTLE_MS = 2_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reclassify cached inbox messages that match a rule's key. Adding,
 * reassigning, or deleting a rule can only change the category of messages
 * its key matches, so this candidate set is sufficient.
 */
const reclassifyRuleMatches = async (rule: RouteRuleRecord): Promise<void> => {
  const sweep = async (): Promise<void> => {
    const cached = (await db.messages.toArray()).filter((m) => ruleMatchesMessage(rule, m));
    await reclassifyMessages(cached);
  };
  await sweep();
  // A scan in flight may still hold matching rows in an unflushed batch that
  // was classified before the rule landed; those rows would be written after
  // the sweep above with pre-rule categories. Sweep again once the scan
  // chain drains.
  if (scanActive()) await serialized(sweep);
  // The live new-mail path can likewise be mid-classification when the rule
  // lands and write its row after the sweeps above; one settled pass catches
  // those stragglers.
  await sleep(RULE_SWEEP_SETTLE_MS);
  await sweep();
}

export const handleCommand = async (msg: ClientMsg): Promise<void> => {

  switch (msg.type) {
    case "hello": {
      await pushMyEmails();
      // Always answer, so the SPA can tell "nothing is scanning" from "not
      // told yet" and doesn't show inbox zero over a cache still filling.
      broadcast(
        getLastProgress() ?? { type: "backfill-progress", scanned: 0, classified: 0, done: true },
      );
      const tripScan = await getTripScanStatus();
      if (tripScan) broadcast({ type: "trip-scan-progress", ...tripScan });
      const archiveImport = await getArchiveImportStatus();
      if (archiveImport) broadcast({ type: "archive-import-progress", ...archiveImport });
      const inboxImport = await getInboxImportStatus();
      if (inboxImport) broadcast({ type: "inbox-import-progress", ...inboxImport });
      return;
    }
    case "trip-scan": {
      const run = msg.archive
        ? startArchiveTripScan({
            rebuild: msg.rebuild,
            importSince: msg.importSince,
            inboxSince: msg.inboxSince,
          })
        : runTripScan({ archive: false, rebuild: msg.rebuild });
      void run.catch((e) => log.warn("trip-extract", "trip scan failed", e));
      return;
    }
    case "trip-scan-cancel": {
      cancelTripScan();
      return;
    }
    case "archive-import": {
      void startArchiveImport(msg.since).catch((e) => log.warn("archive-import", "failed", e));
      return;
    }
    case "archive-import-cancel": {
      cancelArchiveImport();
      return;
    }
    case "retry-backfill": {
      void runBackfill().catch((e) => log.warn("backfill", "retry failed", e));
      return;
    }
    case "hydrate-details": {
      await hydrateDetails(msg.messageKeys);
      return;
    }
    case "pin": {
      try {
        await pinMessage(msg.messageKey, msg.pinned);
      } catch (e) {
        // Fall through to the echo below: it rebroadcasts the message's real
        // state, which reverts the UI's optimistic pin instead of stranding it.
        log.warn("command", "pin failed", { key: msg.messageKey, e: String(e) });
      }
      // Pins are local state, so the cached row is all there is to refresh.
      const cached = await db.messages.get(msg.messageKey);
      if (!cached) return;
      const raw = await applyLocalState({ ...cached });
      await db.messages.put(raw);
      broadcast({ type: "delta", updated: [raw] });
      return;
    }
    case "mark-read": {
      const updated: RawMessage[] = [];
      for (const key of msg.messageKeys) {
        const cached = await db.messages.get(key);
        if (!cached || cached.read) continue;
        try {
          const id = await liveTbId(cached);
          if (id === null) throw new Error("Message no longer exists");
          await messenger.messages.update(id, { read: true });
          // onUpdated reports this too; writing it now means a reload before
          // that event lands doesn't show the row unread again.
          const row: RawMessage = { ...cached, tbId: id, read: true };
          await db.messages.put(row);
          updated.push(row);
        } catch (e) {
          // Echo the real state, reverting the UI's optimistic flip.
          log.warn("command", "mark-read failed", { key, e: String(e) });
          updated.push(cached);
        }
      }
      if (updated.length) broadcast({ type: "delta", updated });
      return;
    }
    case "done": {
      const cached = await db.messages.get(msg.messageKey);
      let archived: ArchivedCopy | null = null;
      try {
        archived = await doneMessage(msg.messageKey);
      } catch (e) {
        log.warn("command", "done failed", { key: msg.messageKey, e: String(e) });
        broadcast({
          type: "command-failed",
          command: "done",
          messageKey: msg.messageKey,
          reason: String((e as Error)?.message ?? e),
        });
        return;
      }
      // Done is a NeoInbox-local fact, and this is where it gets recorded. The
      // archive itself already happened; we carry the existing row over to the
      // destination doneMessage reported rather than reading the message back
      // out of the archive folder.
      if (cached) {
        await clearResurfaced(pinKeyOf(cached));
        const row: RawMessage = { ...cached, origin: "done" };
        if (archived) {
          row.tbId = archived.id;
          row.folderId = archived.folderId;
          row.key = messageKeyOf(row);
        }
        await applyLocalState(row);
        if (row.key !== cached.key) {
          await db.messages.delete(cached.key);
          await db.messages.put(row);
          broadcast({ type: "delta", removedKeys: [cached.key], added: [row] });
        } else {
          await db.messages.put(row);
          broadcast({ type: "delta", updated: [row] });
        }
      }
      return;
    }
    case "move-to-inbox": {
      const cached = await db.messages.get(msg.messageKey);
      let movedHeader: messenger.messages.MessageHeader | undefined;
      let opId: number | null = null;
      let inboxId = "";
      try {
        // Done rows hold the oldest ids in the cache; never move an
        // unverified one (it could be a different message entirely).
        opId = cached ? await opTbId(msg.messageKey) : null;
        if (!cached || opId === null) throw new Error("Message no longer exists");
        const accountId = cached.accountId;
        const target = (await collectInboxFolders()).find((f) => f.accountId === accountId);
        if (!target) throw new Error("No inbox folder found for this account");
        inboxId = target.id;
        const moved = (await messenger.messages.move(
          [opId],
          target.id as unknown as messenger.folders.MailFolderId,
        )) as { messages?: messenger.messages.MessageHeader[] } | undefined;
        movedHeader = moved?.messages?.[0];
      } catch (e) {
        log.warn("command", "move-to-inbox failed", { key: msg.messageKey, e: String(e) });
        broadcast({
          type: "command-failed",
          command: "move-to-inbox",
          messageKey: msg.messageKey,
          reason: String((e as Error)?.message ?? e),
        });
        return;
      }
      try {
        // An IMAP move often hands nothing back, so find the inbox copy by
        // Message-ID. Never fall back to the original id: on Gmail it still
        // resolves (moving out of All Mail only adds a label), and an inbox
        // row cached from it is stuck in All Mail, where Done can't archive it.
        const header =
          movedHeader ?? (await findByHeaderMessageIdInFolder(inboxId, cached.headerMessageId));
        if (!header) return;
        const raw = headerToRawMessage(header, "inbox");
        carryClassification(raw, cached);
        await applyLocalState(raw);
        await applyMessageDetails(raw, cached);
        if (raw.key !== msg.messageKey) {
          await db.messages.delete(msg.messageKey);
          broadcast({ type: "delta", removedKeys: [msg.messageKey] });
        }
        await db.messages.put(raw);
        broadcast({ type: "delta", added: [raw] });
      } catch {
        /* The moved copy isn't readable yet; onMoved/backfill will cache it. */
      }
      return;
    }
    case "trash": {
      try {
        await trashMessage(msg.messageKey);
      } catch (e) {
        log.warn("command", "trash failed", { key: msg.messageKey, e: String(e) });
        broadcast({
          type: "command-failed",
          command: "trash",
          messageKey: msg.messageKey,
          reason: String((e as Error)?.message ?? e),
        });
        return;
      }
      await db.messages.delete(msg.messageKey);
      broadcast({ type: "delta", removedKeys: [msg.messageKey] });
      return;
    }
    case "spam": {
      try {
        await spamMessage(msg.messageKey);
      } catch (e) {
        log.warn("command", "spam failed", { key: msg.messageKey, e: String(e) });
        broadcast({
          type: "command-failed",
          command: "spam",
          messageKey: msg.messageKey,
          reason: String((e as Error)?.message ?? e),
        });
        return;
      }
      await db.messages.delete(msg.messageKey);
      broadcast({ type: "delta", removedKeys: [msg.messageKey] });
      return;
    }
    case "snooze": {
      const cached = await db.messages.get(msg.messageKey);
      try {
        await snoozeMessage(msg.messageKey, msg.wakeAt);
      } catch (e) {
        log.warn("command", "snooze failed", { key: msg.messageKey, e: String(e) });
        broadcast({
          type: "command-failed",
          command: "snooze",
          messageKey: msg.messageKey,
          reason: String((e as Error)?.message ?? e),
        });
        return;
      }
      // snoozeMessage refuses uncached rows, so this always has one.
      if (cached) {
        const raw = { ...cached, snoozed: true, origin: "inbox" as const };
        await db.messages.put(raw);
        broadcast({ type: "delta", updated: [raw] });
      }
      return;
    }
    case "unsnooze": {
      try {
        await wakeSnoozedMessage(msg.messageKey, "unsnooze");
      } catch (e) {
        log.warn("command", "unsnooze failed", { key: msg.messageKey, e: String(e) });
        broadcast({
          type: "command-failed",
          command: "unsnooze",
          messageKey: msg.messageKey,
          reason: String((e as Error)?.message ?? e),
        });
      }
      return;
    }
    case "set-route-rule": {
      // One destination per (type, value) key: reassign rather than duplicate.
      const existing = await db.routeRules
        .where("[type+value]")
        .equals([msg.rule.type, msg.rule.value])
        .first();
      if (existing && existing.id !== msg.rule.id) await db.routeRules.delete(existing.id);
      await db.routeRules.put(msg.rule);
      invalidateRouteRules();
      void reclassifyRuleMatches(msg.rule).catch((e) =>
        log.warn("reclassify", "after set-route-rule failed", e),
      );
      return;
    }
    case "delete-route-rule": {
      const rule = await db.routeRules.get(msg.id);
      if (!rule) return;
      await db.routeRules.delete(msg.id);
      invalidateRouteRules();
      void reclassifyRuleMatches(rule).catch((e) =>
        log.warn("reclassify", "after delete-route-rule failed", e),
      );
      return;
    }
    case "set-custom-bundle": {
      // Bundle records are display metadata only; rules arrive separately.
      await db.customBundles.put(msg.bundle);
      return;
    }
    case "delete-custom-bundle": {
      await db.customBundles.delete(msg.id);
      await db.routeRules.where("target").equals(msg.id).delete();
      invalidateRouteRules();
      const affected = (await db.messages.toArray()).filter(
        (m) => m.origin === "inbox" && m.category === msg.id,
      );
      await reclassifyMessages(affected);
      return;
    }
    case "set-trips-enabled": {
      await setTripsEnabled(msg.enabled);
      // Only travel mail changes hands: whatever is in Travel, and travel in
      // Updates (where it goes with trips on, a rule into Travel included).
      const travelRules = (await db.routeRules.toArray()).filter((r) => r.target === "travel");
      const affected = (await db.messages.toArray()).filter(
        (m) =>
          m.origin === "inbox" &&
          (m.category === "travel" ||
            (m.category === "updates" &&
              (matchesTravel(extractFeatures(m, {})) ||
                travelRules.some((r) => ruleMatchesMessage(r, m))))),
      );
      await reclassifyMessages(affected);
      if (msg.enabled) scheduleTripExtraction();
      return;
    }
    case "reclassify": {
      invalidateRouteRules();
      const wanted = msg.messageKeys ? new Set(msg.messageKeys) : null;
      const cached = (await db.messages.toArray()).filter(
        (m) => m.origin === "inbox" && (!wanted || wanted.has(m.key)),
      );
      const result = await reclassifyMessages(cached);
      broadcast({ type: "reclassify-done", ...result });
      return;
    }
    case "compose": {
      let result: Awaited<ReturnType<typeof runCompose>>;
      try {
        result = await runCompose(msg.draft, msg.send);
      } catch (e) {
        log.warn("compose", "couldn't open compose window", e);
        result = { outcome: "failed", error: e instanceof Error ? e.message : String(e) };
      }
      broadcast({ type: "compose-result", requestId: msg.requestId, ...result });
      return;
    }
    case "write-trips": {
      const { type: _type, ...change } = msg;
      await writeTrips(change);
      return;
    }
  }
};

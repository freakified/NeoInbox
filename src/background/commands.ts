/**
 * Handlers for every command the SPA sends over the port.
 *
 * Split out of index.ts so the command layer can be driven directly in tests:
 * index.ts is wiring with top-level side effects (alarms, listeners, sweeps)
 * and cannot be imported without a live Thunderbird.
 */
import {
  applyMessageDetails,
  classifyMessage,
  doneMessage,
  getLiveHeader,
  loadMessageBody,
  pinMessage,
  trashMessage,
  verifiedOpId,
} from "./ingest";
import type { ArchivedCopy } from "./archiveFolders";
import { applyClassification, carryClassification } from "../classifier/version";
import { headerToRawMessage } from "./messageMap";
import { snoozeMessage, wakeSnoozedMessage } from "./snooze";
import {
  getLastProgress,
  hydrateDetails,
  raiseInboxScanCap,
  runBackfill,
  serialized,
} from "./backfill";
import { scanActive } from "./scanGuard";
import { runCompose } from "./compose";
import { cancelTripScan, getTripScanStatus, runTripScan } from "./extract";
import { pushMyEmails } from "./sync";
import { applyLocalState } from "./localState";
import { broadcast } from "./port";
import { invalidateRouteRules } from "../classifier/routeRules";
import { db } from "../store/db";
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
  const removedIds: number[] = [];
  let moved = 0;
  for (const cmsg of cached) {
    try {
      // Cached ids go stale when Thunderbird remaps them (moves, compaction, a
      // rebuilt folder database). Resolve by Message-ID rather than letting the
      // row fail with "Message not found" and silently keep its old category.
      const header = await getLiveHeader(cmsg);
      if (!header) {
        log.debug("reclassify", "message no longer resolvable; skipped", { id: cmsg.id });
        continue;
      }
      const raw = headerToRawMessage(header, "inbox");
      const body = await loadMessageBody(header.id);
      applyClassification(raw, await classifyMessage(header, body));
      await applyLocalState(raw);
      await applyMessageDetails(raw, cmsg, body);
      if (raw.id === cmsg.id) {
        updated.push(raw);
      } else {
        await db.messages.delete(cmsg.id);
        removedIds.push(cmsg.id);
        readded.push(raw);
      }
      await db.messages.put(raw);
      if ((raw.category ?? null) !== (cmsg.category ?? null)) moved++;
    } catch (e) {
      log.warn("reclassify", "failed", { id: cmsg.id, e });
    }
  }
  // One combined delta: re-keyed rows must land before the old id is dropped
  // or the row would blink out of the stream in between.
  if (updated.length || readded.length || removedIds.length) {
    broadcast({ type: "delta", updated, added: readded, removedIds });
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
      const last = getLastProgress();
      if (last) broadcast(last);
      const tripScan = await getTripScanStatus();
      if (tripScan) broadcast({ type: "trip-scan-progress", ...tripScan });
      return;
    }
    case "trip-scan": {
      void runTripScan({ archive: msg.archive, rebuild: msg.rebuild });
      return;
    }
    case "trip-scan-cancel": {
      cancelTripScan();
      return;
    }
    case "retry-backfill": {
      void runBackfill().catch((e) => log.warn("backfill", "retry failed", e));
      return;
    }
    case "hydrate-details": {
      await hydrateDetails(msg.messageIds);
      return;
    }
    case "load-more-inbox": {
      const cap = await raiseInboxScanCap();
      log.info("backfill", `inbox window widened to ${cap}; rescanning`);
      void runBackfill().catch((e) => log.warn("backfill", "load-more rescan failed", e));
      return;
    }
    case "pin": {
      try {
        await pinMessage(msg.messageId, msg.pinned);
      } catch (e) {
        // Fall through to the echo below: it rebroadcasts the message's real
        // state, which reverts the UI's optimistic pin instead of stranding it.
        log.warn("command", "pin failed", { id: msg.messageId, e: String(e) });
      }
      const header = await messenger.messages.get(msg.messageId);
      const cached = await db.messages.get(msg.messageId);
      const raw = headerToRawMessage(header, cached?.origin ?? "inbox");
      carryClassification(raw, cached);
      await applyLocalState(raw);
      await applyMessageDetails(raw, cached);
      await db.messages.put(raw);
      broadcast({ type: "delta", updated: [raw] });
      return;
    }
    case "done": {
      const cached = await db.messages.get(msg.messageId);
      let archived: ArchivedCopy | null = null;
      try {
        archived = await doneMessage(msg.messageId);
      } catch (e) {
        log.warn("command", "done failed", { id: msg.messageId, e: String(e) });
        broadcast({
          type: "command-failed",
          command: "done",
          messageId: msg.messageId,
          reason: String((e as Error)?.message ?? e),
        });
        return;
      }
      // Done is a NeoInbox-local fact, and this is where it gets recorded. The
      // archive itself already happened; we carry the existing row over to the
      // destination doneMessage reported rather than reading the message back
      // out of the archive folder.
      if (cached) {
        const row: RawMessage = {
          ...cached,
          origin: "done",
          ...(archived ? { id: archived.id, folderId: archived.folderId } : {}),
        };
        await applyLocalState(row);
        if (archived && archived.id !== cached.id) {
          await db.messages.delete(cached.id);
          await db.messages.put(row);
          broadcast({ type: "delta", removedIds: [cached.id], added: [row] });
        } else {
          await db.messages.put(row);
          broadcast({ type: "delta", updated: [row] });
        }
        return;
      }
      await db.messages.delete(msg.messageId);
      broadcast({ type: "delta", removedIds: [msg.messageId] });
      return;
    }
    case "move-to-inbox": {
      const cached = await db.messages.get(msg.messageId);
      let movedHeader: messenger.messages.MessageHeader | undefined;
      let opId = msg.messageId;
      try {
        // Done rows are the most stale-prone ids in the cache; never move an
        // unverified one (it could be a different message entirely).
        const verified = await verifiedOpId(msg.messageId);
        if (verified === null) throw new Error("Message no longer exists");
        opId = verified;
        const accountId =
          cached?.accountId ??
          ((await messenger.messages.get(opId)) as messenger.messages.MessageHeader & {
            folder?: { accountId?: string };
          }).folder?.accountId ??
          "";
        const target = (await collectInboxFolders()).find((f) => f.accountId === accountId);
        if (!target) throw new Error("No inbox folder found for this account");
        const moved = (await messenger.messages.move(
          [opId],
          target.id as unknown as messenger.folders.MailFolderId,
        )) as { messages?: messenger.messages.MessageHeader[] } | undefined;
        movedHeader = moved?.messages?.[0];
      } catch (e) {
        log.warn("command", "move-to-inbox failed", { id: msg.messageId, e: String(e) });
        broadcast({
          type: "command-failed",
          command: "move-to-inbox",
          messageId: msg.messageId,
          reason: String((e as Error)?.message ?? e),
        });
        return;
      }
      try {
        const header = await messenger.messages.get(movedHeader?.id ?? opId);
        const raw = headerToRawMessage(header, "inbox");
        carryClassification(raw, cached);
        await applyLocalState(raw);
        await applyMessageDetails(raw, cached);
        if (raw.id !== msg.messageId) {
          await db.messages.delete(msg.messageId);
          broadcast({ type: "delta", removedIds: [msg.messageId] });
        }
        await db.messages.put(raw);
        broadcast({ type: "delta", added: [raw] });
      } catch {
        /* The move may have assigned a new message id; onMoved/backfill will cache it. */
      }
      return;
    }
    case "trash": {
      try {
        await trashMessage(msg.messageId);
      } catch (e) {
        log.warn("command", "trash failed", { id: msg.messageId, e: String(e) });
        broadcast({
          type: "command-failed",
          command: "trash",
          messageId: msg.messageId,
          reason: String((e as Error)?.message ?? e),
        });
        return;
      }
      await db.messages.delete(msg.messageId);
      broadcast({ type: "delta", removedIds: [msg.messageId] });
      return;
    }
    case "snooze": {
      let removedId: number;
      const cached = await db.messages.get(msg.messageId);
      try {
        ({ removedId } = await snoozeMessage(msg.messageId, msg.wakeAt));
      } catch (e) {
        log.warn("command", "snooze failed", { id: msg.messageId, e: String(e) });
        broadcast({
          type: "command-failed",
          command: "snooze",
          messageId: msg.messageId,
          reason: String((e as Error)?.message ?? e),
        });
        return;
      }
      if (cached) {
        const raw = {
          ...cached,
          snoozed: true,
          origin: "inbox" as const,
        };
        await db.messages.put(raw);
        broadcast({ type: "delta", updated: [raw] });
      } else {
        await db.messages.delete(removedId);
        broadcast({ type: "delta", removedIds: [removedId] });
      }
      return;
    }
    case "unsnooze": {
      try {
        await wakeSnoozedMessage(msg.messageId, "unsnooze");
      } catch (e) {
        log.warn("command", "unsnooze failed", { id: msg.messageId, e: String(e) });
        broadcast({
          type: "command-failed",
          command: "unsnooze",
          messageId: msg.messageId,
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
    case "reclassify": {
      invalidateRouteRules();
      const wanted = msg.messageIds ? new Set(msg.messageIds) : null;
      const cached = (await db.messages.toArray()).filter(
        (m) => m.origin === "inbox" && (!wanted || wanted.has(m.id)),
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
  }
};

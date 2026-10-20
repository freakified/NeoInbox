import { runBackfill, runIncrementalSync } from "./backfill";
import { withTimeout } from "./scanQueue";
import { isTripCandidate, scheduleTripExtraction } from "./extract";
import {
  applyMessageDetailsForOrigin,
  classifyMessage,
  loadMessageBody,
  type MessageBody,
} from "./ingest";
import {
  applyClassification,
  carryClassification,
  classificationOutdated,
} from "../classifier/version";
import { applyLocalState, isSnoozedHeader } from "./localState";
import { headerToRawMessage, keyOfHeader } from "./messageMap";
import { broadcast } from "./port";
import { wakeSnoozesForNewMail } from "./snooze";
import { db } from "../store/db";
import { sanitizeTags } from "../shared/categories";
import { collectArchiveFolders, collectDraftFolders, collectInboxFolders, collectSentFolders } from "../shared/folders";
import { log } from "../shared/log";
import type { MessageKey } from "../shared/messageKey";
import type { MessageOrigin, RawMessage } from "../shared/types";

type MessageList = { id?: string | null; messages: messenger.messages.MessageHeader[] };

/**
 * Every header in an event's list, not just the first page.
 *
 * Thunderbird pages event payloads the way it pages list(): past 100
 * messages, `messages` holds the first page and `id` leads to the rest. A
 * listener that reads only `messages` silently drops everything after it —
 * a 2,600-message inbox arriving with a new account came through as its
 * oldest 100.
 */
const drainList = async (
  list: MessageList | undefined,
): Promise<messenger.messages.MessageHeader[]> => {
  const out = [...(list?.messages ?? [])];
  let pageId = list?.id;
  while (pageId) {
    const page: MessageList = await withTimeout(
      messenger.messages.continueList(pageId),
      `continue event list ${pageId}`,
    );
    out.push(...(page.messages ?? []));
    pageId = page.id;
  }
  return out;
};

type OnUpdatedApi = {
  addListener: (
    cb: (
      message: messenger.messages.MessageHeader,
      changedProperties: { tags?: string[]; read?: boolean },
    ) => void,
  ) => void;
};

type OnDeletedApi = {
  addListener: (cb: (messages: MessageList) => void) => void;
};

type OnMovedApi = {
  addListener: (
    cb: (originalMessages: MessageList, movedMessages: MessageList) => void,
  ) => void;
};

const sendingDraftByTabId = new Map<number, number>();

/**
 * The cached rows an event's headers refer to. Event headers carry their
 * folder and Message-ID, so the key comes straight from the header; never
 * from the numeric id alone, which may match a row cached in another session.
 */
const cachedKeysOf = async (list: MessageList | undefined): Promise<MessageKey[]> => {
  const keys: MessageKey[] = [];
  for (const header of await drainList(list)) {
    const key = await cachedKeyOf(header);
    if (key) keys.push(key);
  }
  return keys;
};

const cachedKeyOf = async (header: messenger.messages.MessageHeader): Promise<MessageKey | null> => {
  if (folderIdOf(header)) return keyOfHeader(header);
  // A header without its folder: only a row with this Message-ID *and* this
  // id is safe to match.
  if (!header.headerMessageId) return null;
  const rows = await db.messages.where("headerMessageId").equals(header.headerMessageId).toArray();
  return rows.find((r) => r.tbId === header.id)?.key ?? null;
};

const tabIdOf = (tab: messenger.tabs.Tab): number | undefined => tab.id;

const folderIdOf = (header: messenger.messages.MessageHeader): string => {
  return (
    header as messenger.messages.MessageHeader & {
      folder?: { id?: string };
    }
  ).folder?.id ?? "";
};

const getFolderIds = async (
  collect: () => Promise<{ id: string }[]>,
): Promise<Set<string>> => {
  try {
    return new Set((await collect()).map((f) => f.id));
  } catch (e) {
    log.warn("sync", "folder lookup failed", e);
    return new Set();
  }
};

const cacheOne = async (
  header: messenger.messages.MessageHeader,
  origin: MessageOrigin,
): Promise<RawMessage> => {
  const fresh = await messenger.messages.get(header.id);
  const raw = headerToRawMessage(fresh, origin);
  // Only inbox mail is classified, and only inbox mail costs a body fetch.
  // Archived mail never reaches here at all — see originForFolder.
  let body: MessageBody | undefined;
  if (origin === "inbox") {
    body = await loadMessageBody(fresh.id);
    applyClassification(raw, await classifyMessage(fresh, body));
  }
  await applyLocalState(raw);
  const cached = await db.messages.get(raw.key);
  await applyMessageDetailsForOrigin(raw, cached, body);
  return raw;
};

const cacheMessages = async (
  headers: readonly messenger.messages.MessageHeader[],
  origin: MessageOrigin,
): Promise<RawMessage[]> => {
  const out: RawMessage[] = [];
  for (const header of headers) {
    try {
      out.push(await withTimeout(cacheOne(header, origin), `cache message ${header.id}`));
    } catch (e) {
      log.warn("sync", "cacheMessages per-msg failed", {
        id: header.id,
        origin,
        e,
      });
    }
  }
  if (out.length) await db.messages.bulkPut(out);
  return out;
};

/**
 * The origin a folder implies, for folders NeoInbox actually reads.
 *
 * Archive folders are deliberately absent. "Done" is a NeoInbox-local fact —
 * "you pressed Done on this" — not "this message lives in the archive folder".
 * Mapping the archive to an origin here is what used to make every archive
 * event fetch a body and run the classifier, which on a Gmail account means
 * doing that for All Mail. Archive arrivals are now handled by
 * `reKeyArchivedRow`, which only touches rows NeoInbox already knows about.
 */
const originForFolder = async (folderId: string): Promise<MessageOrigin | undefined> => {
  const [inboxIds, sentIds, draftIds] = await Promise.all([
    getFolderIds(collectInboxFolders),
    getFolderIds(collectSentFolders),
    getFolderIds(collectDraftFolders),
  ]);
  if (sentIds.has(folderId)) return "sent";
  if (draftIds.has(folderId)) return "draft";
  if (inboxIds.has(folderId)) return "inbox";
  return undefined;
};

const isArchiveFolderId = async (folderId: string): Promise<boolean> => {
  if (!folderId) return false;
  return (await getFolderIds(collectArchiveFolders)).has(folderId);
};

/**
 * Follows a row NeoInbox already has into the archive, without reading it.
 *
 * A message we archived keeps its cached row — same subject, same category,
 * already classified — so landing in the archive is a re-key, not an ingest:
 * take the new id and folder from the move event and keep everything else.
 * Returns null for mail NeoInbox has no row for, which is how archiving done
 * in Thunderbird proper (or on your phone) stays invisible here rather than
 * pulling a body per message.
 */
const reKeyArchivedRow = async (
  originalKey: MessageKey,
  moved: messenger.messages.MessageHeader,
): Promise<RawMessage | null> => {
  const cached = await db.messages.get(originalKey);
  if (!cached) return null;
  const next: RawMessage = {
    ...cached,
    key: keyOfHeader(moved),
    tbId: moved.id,
    folderId: folderIdOf(moved),
    origin: "done",
    read: moved.read ?? cached.read,
    tags: sanitizeTags(moved.tags),
  };
  await applyLocalState(next);
  if (next.key !== originalKey) await db.messages.delete(originalKey);
  await db.messages.put(next);
  return next;
};

/** `draftId` comes from this session's onBeforeSend, so it is live. */
const removeSentDraft = async (draftId: number): Promise<void> => {
  let header: messenger.messages.MessageHeader;
  try {
    header = await messenger.messages.get(draftId);
  } catch (e) {
    log.debug("sync", "sent draft was already gone", { draftId, e: String(e) });
    return;
  }
  const key = keyOfHeader(header);
  const cached = await db.messages.get(key);
  if (cached && cached.origin !== "draft") return;
  if (!cached && (await originForFolder(folderIdOf(header))) !== "draft") return;

  try {
    await messenger.messages.delete([draftId], true);
  } catch (e) {
    log.debug("sync", "sent draft could not be deleted", { draftId, e: String(e) });
  }

  if (cached) {
    await db.messages.delete(key);
    broadcast({ type: "delta", removedKeys: [key] });
  }
};

/**
 * A delivery too big to classify message by message: more than a page, or a
 * folder no full scan has visited yet (a freshly added account, whose whole
 * inbox arrives as "new mail"). Each message here would cost a body fetch.
 */
const isBulkArrival = async (
  folderId: string | undefined,
  list: MessageList,
): Promise<boolean> => {
  if (list.id) return true;
  if (!folderId) return false;
  return !(await db.folderCursors.get(folderId))?.fullScanAt;
};

/**
 * Hands a bulk arrival to the full scan, which takes the newest messages up
 * to the inbox window and leaves the rest behind Load more, then does the
 * new-mail follow-ups for whatever of it was cached.
 */
const ingestBulkArrival = async (list: MessageList): Promise<void> => {
  const headers = await drainList(list);
  log.info("sync", `bulk arrival of ${headers.length}; running a full scan`);
  await runBackfill();
  const rows = await db.messages.bulkGet(headers.map((h) => keyOfHeader(h)));
  const added = rows.filter((r): r is RawMessage => r !== undefined);
  if (added.some((m) => isTripCandidate(m))) scheduleTripExtraction();
  await wakeSnoozesForNewMail(added);
};

/** Last message count seen per inbox folder, to tell arrivals from removals. */
const inboxCounts = new Map<string, number>();
let inboxResyncTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Catches inbox arrivals Thunderbird never announces. onNewMailReceived does
 * not fire for every message that lands in an inbox — a forward from your
 * own alt account went unseen until it was opened — so a rising message
 * count is taken as a cue to run the incremental sync, which picks up
 * anything newer than the folder's cursor. Debounced: an IMAP fetch moves the
 * count several times.
 */
const onInboxFolderInfoChanged = async (
  folder: messenger.folders.MailFolder,
  info: messenger.folders.MailFolderInfo,
): Promise<void> => {
  const total = info.totalMessageCount;
  if (total === undefined || !folder.id) return;
  if (!(await getFolderIds(collectInboxFolders)).has(folder.id)) return;
  const previous = inboxCounts.get(folder.id);
  inboxCounts.set(folder.id, total);
  if (previous !== undefined && total <= previous) return;
  clearTimeout(inboxResyncTimer);
  inboxResyncTimer = setTimeout(() => {
    log.debug("sync", "inbox count rose; running incremental sync", { folderId: folder.id });
    void runIncrementalSync().catch((e) => log.warn("sync", "inbox resync failed", e));
  }, 5_000);
};

export const wireSyncEngine = (): void => {
  const onFolderInfoChanged = messenger.folders?.onFolderInfoChanged;
  if (onFolderInfoChanged) {
    onFolderInfoChanged.addListener((folder, info) => {
      void onInboxFolderInfoChanged(folder, info).catch((e) =>
        log.warn("sync", "onFolderInfoChanged failed", e),
      );
    });
  } else {
    log.warn("sync", "folders.onFolderInfoChanged unavailable");
  }


  messenger.messages.onNewMailReceived.addListener(async (folder, list) => {
    try {
      // Mail can land in a folder that isn't a watched inbox (e.g. a
      // server-side filter routes it elsewhere); caching it as "inbox"
      // regardless would show it in the stream and then have the next full
      // scan prune it as stranded, since its folder isn't in the scanned set.
      log.debug("sync", `onNewMailReceived ${list.messages.length} in ${folder?.id}`);
      const inboxIds = await getFolderIds(collectInboxFolders);
      if (folder?.id && !inboxIds.has(folder.id)) {
        log.debug("sync", "new mail outside the watched inboxes", { folderId: folder.id });
        return;
      }
      if (await isBulkArrival(folder?.id, list)) {
        await ingestBulkArrival(list);
        return;
      }
      const added = await cacheMessages(list.messages, "inbox");
      if (!added.length) return;
      broadcast({ type: "delta", added });
      if (added.some((m) => isTripCandidate(m))) scheduleTripExtraction();
      await wakeSnoozesForNewMail(added);
    } catch (e) {
      log.error("sync", "onNewMail flush failed", e);
    }
  });

  const onAfterSend = messenger.compose?.onAfterSend;
  if (onAfterSend) {
    onAfterSend.addListener(async (tab, sendInfo) => {
      const tabId = tabIdOf(tab);
      const sentDraftId = tabId === undefined ? undefined : sendingDraftByTabId.get(tabId);
      if (tabId !== undefined) sendingDraftByTabId.delete(tabId);

      try {
        if (sendInfo.error) {
          log.warn("sync", "onAfterSend reported error", sendInfo.error);
          return;
        }
        const added = await cacheMessages(sendInfo.messages ?? [], "sent");
        if (added.length) {
          broadcast({ type: "delta", added });
          log.debug("sync", `onAfterSend added ${added.length} sent copies`);
        }
        if (sentDraftId !== undefined) await removeSentDraft(sentDraftId);
      } catch (e) {
        log.warn("sync", "onAfterSend failed", e);
      }
    });
  } else {
    log.warn("sync", "compose.onAfterSend unavailable");
  }

  const onAfterSave = messenger.compose?.onAfterSave;
  if (onAfterSave) {
    onAfterSave.addListener(async (_tab, saveInfo) => {
      try {
        if (saveInfo.error) {
          log.warn("sync", "onAfterSave reported error", saveInfo.error);
          return;
        }
        if (saveInfo.mode === "template") return;
        const added = await cacheMessages(saveInfo.messages ?? [], "draft");
        if (!added.length) return;
        broadcast({ type: "delta", added });
        log.debug("sync", `onAfterSave added ${added.length} draft copies`);
      } catch (e) {
        log.warn("sync", "onAfterSave failed", e);
      }
    });
  } else {
    log.warn("sync", "compose.onAfterSave unavailable");
  }

  const onBeforeSend = messenger.compose?.onBeforeSend;
  if (onBeforeSend) {
    onBeforeSend.addListener((tab, details) => {
      const tabId = tabIdOf(tab);
      if (tabId === undefined) return {};
      if (details.type === "draft" && details.relatedMessageId !== undefined) {
        sendingDraftByTabId.set(tabId, details.relatedMessageId);
      } else {
        sendingDraftByTabId.delete(tabId);
      }
      return {};
    });
  } else {
    log.warn("sync", "compose.onBeforeSend unavailable");
  }

  const onUpdated = (
    messenger.messages as unknown as { onUpdated?: OnUpdatedApi }
  ).onUpdated;
  if (onUpdated) {
    onUpdated.addListener(async (header) => {
      try {
        const fresh = await messenger.messages.get(header.id);
        const cached = await db.messages.get(keyOfHeader(fresh));
        const folderId = folderIdOf(fresh);
        // A flag change on archived mail: refresh what the event already told
        // us and stop. Anything else here would classify it, and a mailbox-wide
        // "mark all read" in All Mail would then fetch a body per message.
        if (await isArchiveFolderId(folderId)) {
          if (!cached) return;
          const next: RawMessage = {
            ...cached,
            origin: "done",
            folderId,
            read: fresh.read ?? cached.read,
            tags: sanitizeTags(fresh.tags),
          };
          await applyLocalState(next);
          await db.messages.put(next);
          broadcast({ type: "delta", updated: [next] });
          return;
        }
        let origin = cached?.origin;
        if (!origin || cached?.folderId !== folderId) {
          origin = await originForFolder(folderId);
        }
        if (!origin) return;
        const logicalOrigin = origin === "done" && (await isSnoozedHeader(fresh))
          ? "inbox"
          : origin;
        // Only reuse the cached category if the row was actually classified:
        // inbox rows always were, done rows carry one since bundle views
        // started including archived mail. A null on a sent/draft row (or a
        // legacy done row) must not stick once the message lands somewhere
        // that needs a category — reclassify instead of carrying it forward.
        // A category decided under older rules is likewise not reusable.
        const reusable =
          !classificationOutdated(cached) &&
          (cached?.origin === "inbox" ||
            (cached?.origin === "done" && cached.category !== null));
        const raw = headerToRawMessage(fresh, logicalOrigin);
        let body: MessageBody | undefined;
        if (reusable) {
          carryClassification(raw, cached);
        } else if (logicalOrigin === "inbox" || logicalOrigin === "done") {
          body = await loadMessageBody(fresh.id);
          applyClassification(raw, await classifyMessage(fresh, body));
        }
        await applyLocalState(raw);
        await applyMessageDetailsForOrigin(raw, cached, body);
        await db.messages.put(raw);
        broadcast({ type: "delta", updated: [raw] });
      } catch (e) {
        log.warn("sync", "onUpdated failed", { id: header.id, e });
      }
    });
  } else {
    log.warn("sync", "messages.onUpdated unavailable");
  }

  const onDeleted = (messenger.messages as unknown as { onDeleted?: OnDeletedApi }).onDeleted;
  if (onDeleted) {
    onDeleted.addListener(async (messages) => {
      try {
        const removedKeys = [];
        for (const key of await cachedKeysOf(messages)) {
          if (await db.snoozes.get(key)) continue;
          removedKeys.push(key);
        }
        if (!removedKeys.length) return;
        await db.messages.bulkDelete(removedKeys);
        broadcast({ type: "delta", removedKeys });
        log.debug("sync", `onDeleted removed ${removedKeys.length}`);
      } catch (e) {
        log.warn("sync", "onDeleted failed", e);
      }
    });
  } else {
    log.warn("sync", "messages.onDeleted unavailable");
  }

  const onMoved = (messenger.messages as unknown as { onMoved?: OnMovedApi }).onMoved;
  if (onMoved) {
    onMoved.addListener(async (originalMessages, movedMessages) => {
      try {
        const originals = await drainList(originalMessages);
        if (!originals.length) return;
        const movedHeaders = await drainList(movedMessages);
        const originalKeys: MessageKey[] = [];
        const byOrigin = new Map<MessageOrigin, messenger.messages.MessageHeader[]>();
        const snoozedOriginalKeys = new Set<MessageKey>();
        /** Rows re-keyed into the archive; already written, just need announcing. */
        const archived: RawMessage[] = [];
        for (let idx = 0; idx < movedHeaders.length; idx++) {
          const moved = movedHeaders[idx]!;
          const original = originals[idx];
          const originalKey = original ? await cachedKeyOf(original) : null;
          if (originalKey) originalKeys.push(originalKey);
          // The snoozed row stays under its inbox key while the message is parked.
          if (originalKey && (await db.snoozes.get(originalKey))) {
            snoozedOriginalKeys.add(originalKey);
            continue;
          }
          const fresh = await messenger.messages.get(moved.id);
          if (await isSnoozedHeader(fresh)) {
            if (originalKey) snoozedOriginalKeys.add(originalKey);
            continue;
          }
          // Into the archive: re-key our own row if we have one, and ignore
          // the message entirely if we don't. Never a body fetch either way.
          if (await isArchiveFolderId(folderIdOf(fresh))) {
            if (!originalKey) continue;
            const reKeyed = await reKeyArchivedRow(originalKey, fresh);
            if (reKeyed) archived.push(reKeyed);
            continue;
          }
          const origin = await originForFolder(folderIdOf(fresh));
          if (!origin) continue;
          const arr = byOrigin.get(origin) ?? [];
          arr.push(fresh);
          byOrigin.set(origin, arr);
        }
        // Cache the moved copies before dropping the old rows and ship one
        // combined delta: removing first would leave a visible gap (e.g. a
        // trip card showing empty) for as long as classification takes.
        const added = [...archived];
        for (const [origin, headers] of byOrigin) {
          added.push(...await cacheMessages(headers, origin));
        }
        const addedKeys = new Set(added.map((m) => m.key));
        const removedKeys = originalKeys.filter(
          (key) => !snoozedOriginalKeys.has(key) && !addedKeys.has(key),
        );
        if (removedKeys.length) await db.messages.bulkDelete(removedKeys);
        if (removedKeys.length || added.length) {
          broadcast({ type: "delta", removedKeys, added });
        }
        log.debug("sync", `onMoved removed ${removedKeys.length}, cached ${added.length} moved messages`);
      } catch (e) {
        log.warn("sync", "onMoved failed", e);
      }
    });
  } else {
    log.warn("sync", "messages.onMoved unavailable");
  }
};

export const pushMyEmails = async (): Promise<void> => {
  const accounts = await messenger.accounts.list();
  const emails: string[] = [];
  for (const acc of accounts) {
    const identities = (
      acc as unknown as { identities?: { email?: string }[] }
    ).identities ?? [];
    for (const id of identities) {
      if (id.email) emails.push(id.email.toLowerCase());
    }
  }
  broadcast({ type: "myEmails", emails });
};

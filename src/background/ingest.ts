import { classify } from "../classifier/pipeline";
import type { ClassificationResult } from "../classifier/version";
import { extractFeatures } from "../classifier/features";
import { liveTbId } from "../shared/liveMessage";
import { log } from "../shared/log";
import { pinKeyOf } from "../shared/pinKey";
import { scanCidRefs } from "../spa/lib/srcdoc";
import { db } from "../store/db";
import type { MessageKey } from "../shared/messageKey";
import type { AttachmentSummary, Parcel, RawMessage } from "../shared/types";
import { findParcels } from "../classifier/extractors/tracking";
import { buildExtractorInput } from "../classifier/samples";
import {
  type ArchivedCopy,
  archiveFolderIdsForAccount,
  findByHeaderMessageIdInFolder,
  locateArchivedCopy,
  messageStillIn,
  messageStillInFolderByHeader,
  resolveArchiveFolder,
} from "./archiveFolders";
import { setPinned } from "./localState";
import { collectInboxFolders } from "../shared/folders";

import { DETAILS_LAZY, MESSAGE_DETAILS_VERSION } from "../shared/details";
import { snippetFromPart } from "../shared/snippet";

export { DETAILS_LAZY, MESSAGE_DETAILS_VERSION };

export class ArchiveFailedError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ArchiveFailedError";
  }
}

export class TrashFailedError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TrashFailedError";
  }
}

const isMessageNotFound = (e: unknown): boolean =>
  String((e as Error)?.message ?? e).includes("Message not found");

/**
 * The Thunderbird id to act on for a cached row, verified by Message-ID
 * (liveTbId), or null when the row is unknown or its message is gone.
 * Destructive ops must never run on the row's unverified hint: a stale one
 * names an unrelated message, which the op would archive/trash instead.
 */
export const opTbId = async (key: MessageKey): Promise<number | null> => {
  const row = await db.messages.get(key);
  return row ? liveTbId(row) : null;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether a moved message has actually left its source folder.
 *
 * IMAP moves settle asynchronously, so this polls with a backoff. Both checks
 * are single lookups — a `messages.get` on the known id, and a folder-scoped
 * Message-ID query for the case where the move left a copy behind under a new
 * id. It previously paged the source folder up to 25 pages on each of these
 * five rounds, which meant every Done could enumerate the inbox.
 */
const messageSettledOutOfFolder = async (
  messageId: number,
  sourceFolderId: string,
  headerMessageId: string,
): Promise<boolean> => {
  for (const delay of [150, 350, 700, 1200]) {
    if (
      !(await messageStillIn(messageId, sourceFolderId)) &&
      !(await messageStillInFolderByHeader(sourceFolderId, headerMessageId))
    ) {
      return true;
    }
    await sleep(delay);
  }
  return (
    !(await messageStillIn(messageId, sourceFolderId)) &&
    !(await messageStillInFolderByHeader(sourceFolderId, headerMessageId))
  );
}

/**
 * One message body, fetched once and passed to everything that needs it.
 *
 * The classifier reads the List-* headers and the details extractor reads
 * References/In-Reply-To — both out of the same getFull(), which on IMAP is a
 * round trip. Ingesting a message used to pay for that trip twice.
 */
export interface MessageBody {
  full: messenger.messages.MessagePart | null;
  /** getFull() rejected, usually because IMAP hasn't synced the body yet. */
  unavailable: boolean;
}

export const loadMessageBody = async (messageId: number): Promise<MessageBody> => {
  try {
    return { full: await messenger.messages.getFull(messageId), unavailable: false };
  } catch (e) {
    log.debug("ingest", "getFull failed", { id: messageId, e });
    return { full: null, unavailable: true };
  }
}

const INCOMPLETE_CLASSIFICATION_KEY = "neoinbox-incomplete-classifications";

/**
 * Whether any row may have been classified without its body.
 *
 * The retry sweep runs after every scan, and the rows it wants can't be found
 * by index: classifiedIncomplete is a boolean, and IndexedDB cannot index one.
 * So the choice is a full read of the cache after every scan or a flag saying
 * whether a read would find anything — this is the flag.
 *
 * Absent means "never established", not "clean": an install upgrading into
 * this code may already hold incomplete rows, so the first pass still looks.
 */
export const anyIncompleteClassifications = async (): Promise<boolean> => {
  const stored = await messenger.storage.local.get(INCOMPLETE_CLASSIFICATION_KEY);
  return stored[INCOMPLETE_CLASSIFICATION_KEY] !== false;
}

export const setIncompleteClassifications = async (present: boolean): Promise<void> => {
  await messenger.storage.local.set({ [INCOMPLETE_CLASSIFICATION_KEY]: present });
}

export const classifyMessage = async (
  header: messenger.messages.MessageHeader,
  body?: MessageBody,
): Promise<ClassificationResult> => {
  const resolved = body ?? (await loadMessageBody(header.id));
  if (resolved.unavailable) {
    // Every classification funnels through here, so this is the one place that
    // can tell the retry sweep it has work waiting.
    void setIncompleteClassifications(true).catch((e) =>
      log.debug("ingest", "recording an incomplete classification failed", e),
    );
  }
  const features = extractFeatures(header, resolved.full?.headers ?? {});
  const category = await classify(features);
  return { category: category ?? null, incomplete: resolved.unavailable };
}

/**
 * Inbox rows cached from their headers alone: older inbox mail brought in by
 * the inbox import rather than the scan. They are classified from headers,
 * and nothing in the background fetches their bodies — not the details fill,
 * the incomplete-classification retry, the version sweep, a reclassify or the
 * automatic trip sweep. A message gets its body when it is opened, or when a
 * full scan finds it inside the scan window.
 */
export const isHeaderOnly = (m: RawMessage): boolean => m.detailsVersion === DETAILS_LAZY;

/**
 * Classifies from the header alone, for rows that must not cost a body fetch.
 * Always incomplete: the body's headers (List-Id and the like) were never read.
 */
export const classifyFromHeader = async (
  header: messenger.messages.MessageHeader,
): Promise<ClassificationResult> => ({
  category: (await classify(extractFeatures(header, {}))) ?? null,
  incomplete: true,
});

/**
 * Fetches the live header for a cached row, re-resolving by Message-ID when
 * Thunderbird has remapped the id (moves, compaction, a rebuilt .msf). Returns
 * null when the message can't be found — callers should skip the row rather
 * than delete it, since the lookup can also fail transiently; real removals
 * are handled by the scan's prune step.
 */
export const getLiveHeader = async (
  row: RawMessage,
): Promise<messenger.messages.MessageHeader | null> => {
  const liveId = await liveTbId(row);
  if (liveId === null) return null;
  try {
    return await messenger.messages.get(liveId);
  } catch (e) {
    log.debug("ingest", "live header fetch failed", { key: row.key, liveId, e: String(e) });
    return null;
  }
}

/** Returned when a row needed re-resolution but the caller had no budget for it. */
export const OVER_BUDGET = Symbol("over-budget");

/**
 * getLiveHeader for callers sweeping many rows at once.
 *
 * The cheap path — the cached id still points at the right message — is always
 * taken. Re-resolution is not: finding a drifted id means searching the account
 * by Message-ID, which costs about a second on a large mailbox, and archived
 * rows drift in bulk. `allow` lets the caller ration those searches so a sweep
 * over the archive backlog cannot saturate the background for hours.
 */
export const liveHeaderWithinBudget = async (
  row: RawMessage,
  allow: () => boolean,
): Promise<messenger.messages.MessageHeader | null | typeof OVER_BUDGET> => {
  try {
    const header = await messenger.messages.get(row.tbId);
    if (!row.headerMessageId || header.headerMessageId === row.headerMessageId) {
      return header;
    }
  } catch {
    /* id no longer resolves; needs the expensive path */
  }
  if (!allow()) return OVER_BUDGET;
  return getLiveHeader(row);
}

export const pinMessage = async (key: MessageKey, pinned: boolean): Promise<void> => {
  const cached = await db.messages.get(key);
  if (!cached) return;
  await setPinned(pinKeyOf(cached), pinned);
}

/**
 * Archives a message for real — this is a server-side move out of the inbox,
 * exactly as Thunderbird's own Archive does. Returns where the message landed
 * so the caller can record it; NeoInbox never reads the archive folder back,
 * so this return value is the only trace of the destination it keeps.
 * Null means the destination couldn't be pinned down (or the message was
 * already gone), which is not an error — the archive itself still happened.
 */
export const doneMessage = async (key: MessageKey): Promise<ArchivedCopy | null> => {
  let id = await opTbId(key);
  if (id === null) {
    log.info("archive", "message no longer exists; treating archive as settled", { key });
    return null;
  }
  let sourceFolderId = "";
  let headerMessageId = "";
  let accountId = "";
  try {
    const msg = await messenger.messages.get(id);
    const folder = (msg as messenger.messages.MessageHeader & {
      folder?: { id?: string; accountId?: string };
    }).folder;
    sourceFolderId = folder?.id ?? "";
    accountId = folder?.accountId ?? "";
    headerMessageId = msg.headerMessageId ?? "";
  } catch (e) {
    if (isMessageNotFound(e)) {
      log.info("archive", "message already gone; treating archive as settled", { id });
      return null;
    }
    throw e;
  }

  // A row resolved to the archive copy is one archive() would skip. On Gmail
  // that happens to inbox mail too, since All Mail holds every message: act on
  // its Inbox copy if it has one, and otherwise it is archived already.
  if ((await archiveFolderIdsForAccount(accountId)).includes(sourceFolderId)) {
    const inboxCopy = await findInboxCopy(accountId, headerMessageId);
    if (!inboxCopy) {
      log.info("archive", "message is already in the archive; treating as settled", { id });
      return { id, folderId: sourceFolderId };
    }
    id = inboxCopy.id;
    sourceFolderId = inboxCopy.folderId;
  }

  let archiveError: unknown = null;
  try {
    await messenger.messages.archive([id]);
  } catch (e) {
    if (isMessageNotFound(e)) {
      log.info("archive", "message disappeared during archive; treating as settled", { id });
      return null;
    }
    archiveError = e;
    log.warn("archive", "messages.archive threw", { id, sourceFolderId, e: String(e) });
  }

  if (await messageSettledOutOfFolder(id, sourceFolderId, headerMessageId)) {
    return locateArchivedCopy(accountId, sourceFolderId, headerMessageId);
  }

  log.warn("archive", "archive() did not move the message; attempting fallback", {
    id,
    sourceFolderId,
  });

  const sourceCopy = await findByHeaderMessageIdInFolder(sourceFolderId, headerMessageId);
  const moveId = sourceCopy?.id ?? id;
  const resolved = await resolveArchiveFolder(moveId);
  if (!resolved) {
    throw new ArchiveFailedError(
      "No Archives folder configured for this account",
      archiveError,
    );
  }

  let movedId = moveId;
  try {
    // move() hands back the copies it created, whose ids differ from the
    // originals'. Taking the id from here is what lets the caller record the
    // destination instead of searching the archive for it later.
    const moved = (await messenger.messages.move(
      [moveId],
      resolved.archiveFolderId as unknown as messenger.folders.MailFolderId,
    )) as { messages?: { id: number }[] } | undefined;
    movedId = moved?.messages?.[0]?.id ?? moveId;
  } catch (e) {
    log.warn("archive", "fallback move failed", {
      id: moveId,
      sourceFolderId,
      archiveFolderId: resolved.archiveFolderId,
      e: String(e),
    });
    throw new ArchiveFailedError("Move to Archives failed", e);
  }

  if (!(await messageSettledOutOfFolder(id, sourceFolderId, headerMessageId))) {
    throw new ArchiveFailedError(
      "Move appeared to succeed but message still in source folder",
      archiveError,
    );
  }
  // The fallback path knows its own destination, so no search is needed.
  return { id: movedId, folderId: resolved.archiveFolderId };
}

/** The copy of a message filed in one of its account's inboxes, if any. */
const findInboxCopy = async (
  accountId: string,
  headerMessageId: string,
): Promise<ArchivedCopy | null> => {
  for (const inbox of await collectInboxFolders()) {
    if (inbox.accountId !== accountId) continue;
    const found = await findByHeaderMessageIdInFolder(inbox.id, headerMessageId);
    if (found) return { id: found.id, folderId: inbox.id };
  }
  return null;
}

export const trashMessage = async (key: MessageKey): Promise<void> => {
  const id = await opTbId(key);
  if (id === null) {
    log.info("trash", "message no longer exists; treating trash as settled", { key });
    return;
  }
  let sourceFolderId = "";
  let headerMessageId = "";
  try {
    const msg = await messenger.messages.get(id);
    sourceFolderId = (msg as messenger.messages.MessageHeader & {
      folder?: { id?: string };
    }).folder?.id ?? "";
    headerMessageId = msg.headerMessageId ?? "";
  } catch (e) {
    if (isMessageNotFound(e)) {
      log.info("trash", "message already gone; treating trash as settled", { id });
      return;
    }
    throw e;
  }

  try {
    const deleteMessages = messenger.messages.delete as unknown as (
      ids: number[],
      options?: { deletePermanently?: boolean },
    ) => Promise<void>;
    await deleteMessages([id], { deletePermanently: false });
  } catch (e) {
    if (isMessageNotFound(e)) {
      log.info("trash", "message disappeared during delete; treating as settled", { id });
      return;
    }
    log.warn("trash", "delete threw", { id, e: String(e) });
    throw new TrashFailedError("Delete failed", e);
  }

  if (await messageSettledOutOfFolder(id, sourceFolderId, headerMessageId)) return;

  log.warn("trash", "delete() did not move the message; retrying", {
    id,
    sourceFolderId,
  });
  const sourceCopy = await findByHeaderMessageIdInFolder(sourceFolderId, headerMessageId);
  const retryId = sourceCopy?.id ?? id;
  try {
    const deleteMessages = messenger.messages.delete as unknown as (
      ids: number[],
      options?: { deletePermanently?: boolean },
    ) => Promise<void>;
    await deleteMessages([retryId], { deletePermanently: false });
  } catch (e) {
    if (!isMessageNotFound(e)) {
      log.warn("trash", "retry delete threw", { id: retryId, e: String(e) });
      throw new TrashFailedError("Delete retry failed", e);
    }
    log.warn("trash", "retry target disappeared before delete settled", {
      id: retryId,
      sourceFolderId,
    });
  }

  if (!(await messageSettledOutOfFolder(id, sourceFolderId, headerMessageId))) {
    throw new TrashFailedError("Delete appeared to succeed but message still in source folder");
  }
}

export const extractAttachments = async (
  messageId: number,
): Promise<AttachmentSummary[]> => {
  return (await extractMessageDetails(messageId)).attachments;
}

export interface MessageDetails {
  attachments: AttachmentSummary[];
  references: string[];
  inReplyTo: string[];
  snippet: string;
  parcels: Parcel[];
}

/** Tracking numbers in a fetched body; never throws, since they're a nicety. */
const parcelsFromPart = (
  full: messenger.messages.MessagePart,
  m: Pick<RawMessage, "author" | "subject" | "date">,
): Parcel[] => {
  const textParts: string[] = [];
  const htmlParts: string[] = [];
  const walk = (part: messenger.messages.MessagePart): void => {
    const ct = (part.contentType ?? "").toLowerCase();
    if (part.body && ct.startsWith("text/html")) htmlParts.push(part.body);
    else if (part.body && ct.startsWith("text/plain")) textParts.push(part.body);
    for (const sub of part.parts ?? []) walk(sub);
  };
  walk(full);
  try {
    return findParcels(buildExtractorInput({ ...m, textParts, htmlParts }));
  } catch (e) {
    log.debug("ingest", "parcel extraction failed", { e: String(e) });
    return [];
  }
};

const messageIdTokens = (value: string): string[] => {
  const bracketed = [...value.matchAll(/<([^>]+)>/g)].map((m) => m[1] ?? "");
  const raw = bracketed.length ? bracketed : value.split(/\s+/);
  return raw
    .map((token) => token.replace(/[<>]/g, "").trim().toLowerCase())
    .filter(Boolean);
}

const headerValues = (
  headers: Record<string, string[]> | undefined,
  name: string,
): string[] => {
  if (!headers) return [];
  const wanted = name.toLowerCase();
  for (const [key, values] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return values;
  }
  return [];
}

export interface DetailsOptions {
  /** An already-fetched body, so this doesn't call getFull() a second time. */
  body?: MessageBody;
  /**
   * Whether to list attachments. Sent and draft rows discard the list — they
   * only need References/In-Reply-To for threading — so fetching it there is a
   * round trip spent on a value the caller throws away.
   */
  attachments?: boolean;
  /** Look for tracking numbers, given the message's sender, subject and date. */
  parcelsOf?: Pick<RawMessage, "author" | "subject" | "date">;
}

export const extractMessageDetails = async (
  messageId: number,
  options: DetailsOptions = {},
): Promise<MessageDetails> => {
  let list: messenger.messages.MessageAttachment[] = [];
  if (options.attachments ?? true) {
    try {
      list = await messenger.messages.listAttachments(messageId);
    } catch {
      list = [];
    }
  }

  const body = options.body ?? (await loadMessageBody(messageId));
  let cidRefs = new Set<string>();
  let references: string[] = [];
  let inReplyTo: string[] = [];
  let snippet = "";
  let parcels: Parcel[] = [];
  // No body available: render every attachment as a card, and thread on
  // subject/participant alone.
  if (body.full) {
    cidRefs = scanCidRefs(body.full);
    references = headerValues(body.full.headers, "references").flatMap(messageIdTokens);
    inReplyTo = headerValues(body.full.headers, "in-reply-to").flatMap(messageIdTokens);
    snippet = snippetFromPart(body.full);
    if (options.parcelsOf) parcels = parcelsFromPart(body.full, options.parcelsOf);
  }

  const attachments = list
    .filter((a) => !isCidReferenced(cidRefs, a.name))
    .map((a) => ({
      name: a.name,
      contentType: a.contentType,
      size: a.size,
      partName: a.partName,
    }));

  return { attachments, references, inReplyTo, snippet, parcels };
}

/**
 * True for rows ingested headers-first (detailsVersion 0) or predating the
 * details fields entirely; fillMissingDetails hydrates these in the background.
 */
export const needsMessageDetails = (m: RawMessage): boolean =>
  !Array.isArray(m.attachments) ||
  !Array.isArray(m.references) ||
  !Array.isArray(m.inReplyTo) ||
  (m.detailsVersion ?? 0) === 0 ||
  // Inbox rows from before the latest details (the list snippet) get them
  // filled in; nothing else does. Done and snoozed mail lives in the archive,
  // and NeoInbox never fetches a body from there.
  (m.origin === "inbox" && !m.snoozed && (m.detailsVersion ?? 0) < MESSAGE_DETAILS_VERSION);

export const canReuseMessageDetails = (
  cached: RawMessage | undefined,
  raw: RawMessage,
): cached is RawMessage & Required<Pick<RawMessage, "attachments" | "references" | "inReplyTo">> => {
  return !!cached
    && cached.size === raw.size
    && Array.isArray(cached.attachments)
    && Array.isArray(cached.references)
    && Array.isArray(cached.inReplyTo);
}

export const applyMessageDetails = async (
  raw: RawMessage,
  cached?: RawMessage,
  body?: MessageBody,
): Promise<void> => {
  if (raw.origin === "inbox" && raw.resurfacedAt === undefined && cached?.resurfacedAt !== undefined) {
    raw.resurfacedAt = cached.resurfacedAt;
    raw.snoozeExpired = cached.snoozeExpired;
  }

  // A header-only row's empty details are reused only while nothing has the
  // body: once a caller fetched it anyway, the real details cost nothing more.
  if (canReuseMessageDetails(cached, raw) && !(body && isHeaderOnly(cached))) {
    raw.attachments = cached.attachments;
    raw.references = cached.references;
    raw.inReplyTo = cached.inReplyTo;
    raw.snippet = cached.snippet;
    raw.parcels = cached.parcels;
    raw.detailsVersion = cached.detailsVersion ?? 0;
    return;
  }

  const details = await extractMessageDetails(raw.tbId, { body, parcelsOf: raw });
  raw.attachments = details.attachments;
  raw.references = details.references;
  raw.inReplyTo = details.inReplyTo;
  raw.snippet = details.snippet;
  raw.parcels = details.parcels.length ? details.parcels : undefined;
  raw.detailsVersion = MESSAGE_DETAILS_VERSION;
}

export const applyMessageDetailsForOrigin = async (
  raw: RawMessage,
  cached?: RawMessage,
  body?: MessageBody,
): Promise<void> => {
  if (raw.origin === "inbox") {
    await applyMessageDetails(raw, cached, body);
    return;
  }

  if (
    canReuseMessageDetails(cached, raw)
    && (cached.detailsVersion ?? 0) >= MESSAGE_DETAILS_VERSION
  ) {
    raw.attachments = cached.attachments;
    raw.references = cached.references;
    raw.inReplyTo = cached.inReplyTo;
    raw.snippet = cached.snippet;
    // Mail archived from the inbox keeps the cards it had there.
    raw.parcels = cached.parcels;
    raw.detailsVersion = cached.detailsVersion ?? 0;
    return;
  }

  const details = await extractMessageDetails(raw.tbId, { body, attachments: false });
  raw.attachments = [];
  raw.references = details.references;
  raw.inReplyTo = details.inReplyTo;
  raw.snippet = details.snippet;
  raw.detailsVersion = MESSAGE_DETAILS_VERSION;
}

const isCidReferenced = (cidRefs: Set<string>, name: string): boolean => {
  if (cidRefs.size === 0 || !name) return false;
  const lower = name.toLowerCase();
  for (const ref of cidRefs) {
    const localPart = ref.split("@")[0] ?? ref;
    if (localPart === lower) return true;
  }
  return false;
}

import { classify } from "../classifier/pipeline";
import type { ClassificationResult } from "../classifier/version";
import { extractFeatures } from "../classifier/features";
import { resolveLiveMessageId } from "../shared/liveMessage";
import { log } from "../shared/log";
import { pinKeyOf } from "../shared/pinKey";
import { scanCidRefs } from "../spa/lib/srcdoc";
import { db } from "../store/db";
import type { AttachmentSummary, RawMessage } from "../shared/types";
import {
  findByHeaderMessageIdInFolder,
  messageStillIn,
  messageStillInFolderByHeader,
  resolveArchiveFolder,
} from "./archiveFolders";
import { setPinned } from "./localState";

export const MESSAGE_DETAILS_VERSION = 2;

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
 * Destructive ops must never run on an unverified id: a cached row's numeric
 * id can go stale (archived rows are never rescanned) and end up referring to
 * an unrelated message, which the op would then archive/trash/move instead.
 * Returns the id verified to be the cached row's message, or null when the
 * message no longer exists. A stale cache row is dropped here; follow-up
 * flows re-cache the message under its live id.
 */
export const verifiedOpId = async (id: number): Promise<number | null> => {
  const cached = await db.messages.get(id);
  if (!cached?.headerMessageId) return id;
  const liveId = await resolveLiveMessageId(cached);
  if (liveId !== null && liveId !== id) {
    log.warn("live-message", "stale id on destructive op; re-resolved", { id, liveId });
    await db.messages.delete(id);
  }
  return liveId;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
 * Fetches the live header for a cached row, re-resolving by Message-ID when
 * Thunderbird has remapped the id (moves, compaction, a rebuilt .msf). Returns
 * null when the message can't be found — callers should skip the row rather
 * than delete it, since the lookup can also fail transiently; real removals
 * are handled by the scan's prune step.
 */
export const getLiveHeader = async (
  row: RawMessage,
): Promise<messenger.messages.MessageHeader | null> => {
  const liveId = await resolveLiveMessageId(row);
  if (liveId === null) return null;
  try {
    return await messenger.messages.get(liveId);
  } catch (e) {
    log.debug("ingest", "live header fetch failed", { id: row.id, liveId, e: String(e) });
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
    const header = await messenger.messages.get(row.id);
    if (!row.headerMessageId || header.headerMessageId === row.headerMessageId) {
      return header;
    }
  } catch {
    /* id no longer resolves; needs the expensive path */
  }
  if (!allow()) return OVER_BUDGET;
  return getLiveHeader(row);
}

export const pinMessage = async (id: number, pinned: boolean): Promise<void> => {
  const cached = await db.messages.get(id);
  const headerMessageId = cached?.headerMessageId
    ?? (await messenger.messages.get(id)).headerMessageId
    ?? "";
  await setPinned(pinKeyOf({ headerMessageId, id }), pinned);
}

export const doneMessage = async (id: number): Promise<void> => {
  const opId = await verifiedOpId(id);
  if (opId === null) {
    log.info("archive", "message no longer exists; treating archive as settled", { id });
    return;
  }
  id = opId;
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
      log.info("archive", "message already gone; treating archive as settled", { id });
      return;
    }
    throw e;
  }

  let archiveError: unknown = null;
  try {
    await messenger.messages.archive([id]);
  } catch (e) {
    if (isMessageNotFound(e)) {
      log.info("archive", "message disappeared during archive; treating as settled", { id });
      return;
    }
    archiveError = e;
    log.warn("archive", "messages.archive threw", { id, sourceFolderId, e: String(e) });
  }

  if (await messageSettledOutOfFolder(id, sourceFolderId, headerMessageId)) return;

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

  try {
    await messenger.messages.move(
      [moveId],
      resolved.archiveFolderId as unknown as messenger.folders.MailFolderId,
    );
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
}

export const trashMessage = async (id: number): Promise<void> => {
  const opId = await verifiedOpId(id);
  if (opId === null) {
    log.info("trash", "message no longer exists; treating trash as settled", { id });
    return;
  }
  id = opId;
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
}

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
  // No body available: render every attachment as a card, and thread on
  // subject/participant alone.
  if (body.full) {
    cidRefs = scanCidRefs(body.full);
    references = headerValues(body.full.headers, "references").flatMap(messageIdTokens);
    inReplyTo = headerValues(body.full.headers, "in-reply-to").flatMap(messageIdTokens);
  }

  const attachments = list
    .filter((a) => !isCidReferenced(cidRefs, a.name))
    .map((a) => ({
      name: a.name,
      contentType: a.contentType,
      size: a.size,
      partName: a.partName,
    }));

  return { attachments, references, inReplyTo };
}

/**
 * True for rows ingested headers-first (detailsVersion 0) or predating the
 * details fields entirely; fillMissingDetails hydrates these in the background.
 */
export const needsMessageDetails = (m: RawMessage): boolean =>
  !Array.isArray(m.attachments) ||
  !Array.isArray(m.references) ||
  !Array.isArray(m.inReplyTo) ||
  (m.detailsVersion ?? 0) === 0;

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
  }

  if (canReuseMessageDetails(cached, raw)) {
    raw.attachments = cached.attachments;
    raw.references = cached.references;
    raw.inReplyTo = cached.inReplyTo;
    raw.detailsVersion = cached.detailsVersion ?? 0;
    return;
  }

  const details = await extractMessageDetails(raw.id, { body });
  raw.attachments = details.attachments;
  raw.references = details.references;
  raw.inReplyTo = details.inReplyTo;
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
    raw.detailsVersion = cached.detailsVersion ?? 0;
    return;
  }

  const details = await extractMessageDetails(raw.id, { body, attachments: false });
  raw.attachments = [];
  raw.references = details.references;
  raw.inReplyTo = details.inReplyTo;
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

import { classify } from "../classifier/pipeline";
import { extractFeatures } from "../classifier/features";
import { PINNED_KEY } from "../shared/categories";
import { log } from "../shared/log";
import { scanCidRefs } from "../spa/lib/srcdoc";
import type { AttachmentSummary, Category, RawMessage } from "../shared/types";
import {
  findByHeaderMessageIdInFolder,
  messageStillIn,
  messageStillInFolderByHeader,
  resolveArchiveFolder,
} from "./archiveFolders";

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

export const classifyMessage = async (
  header: messenger.messages.MessageHeader,
): Promise<Category | null> => {
  let headers: Record<string, string[]> = {};
  try {
    const full = await messenger.messages.getFull(header.id);
    headers = full.headers ?? {};
  } catch (e) {
    log.debug("ingest", "getFull failed", { id: header.id, e });
  }

  const features = extractFeatures(header, headers);
  const category = await classify(features);
  return category ?? null;
}

export const pinMessage = async (id: number, pinned: boolean): Promise<void> => {
  const msg = await messenger.messages.get(id);
  const tags = msg.tags ?? [];
  const next = pinned
    ? [...tags.filter((t) => t !== PINNED_KEY), PINNED_KEY]
    : tags.filter((t) => t !== PINNED_KEY);
  await messenger.messages.update(id, { tags: next });
}

export const doneMessage = async (id: number): Promise<void> => {
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

export const extractMessageDetails = async (
  messageId: number,
): Promise<MessageDetails> => {
  let list: messenger.messages.MessageAttachment[];
  try {
    list = await messenger.messages.listAttachments(messageId);
  } catch {
    list = [];
  }

  let cidRefs = new Set<string>();
  let references: string[] = [];
  let inReplyTo: string[] = [];
  try {
    const full = await messenger.messages.getFull(messageId);
    cidRefs = scanCidRefs(full);
    references = headerValues(full.headers, "references").flatMap(messageIdTokens);
    inReplyTo = headerValues(full.headers, "in-reply-to").flatMap(messageIdTokens);
  } catch {
    /* no body available; render every attachment as a card */
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
): Promise<void> => {
  if (raw.origin === "inbox" && raw.resurfacedAt === undefined && cached?.resurfacedAt !== undefined) {
    raw.resurfacedAt = cached.resurfacedAt;
  }

  if (canReuseMessageDetails(cached, raw)) {
    raw.attachments = cached.attachments;
    raw.references = cached.references;
    raw.inReplyTo = cached.inReplyTo;
    raw.detailsVersion = cached.detailsVersion;
    return;
  }

  const details = await extractMessageDetails(raw.id);
  raw.attachments = details.attachments;
  raw.references = details.references;
  raw.inReplyTo = details.inReplyTo;
  raw.detailsVersion = MESSAGE_DETAILS_VERSION;
}

export const applyMessageDetailsForOrigin = async (
  raw: RawMessage,
  cached?: RawMessage,
): Promise<void> => {
  if (raw.origin === "inbox") {
    await applyMessageDetails(raw, cached);
    return;
  }

  if (
    canReuseMessageDetails(cached, raw)
    && (cached.detailsVersion ?? 0) >= MESSAGE_DETAILS_VERSION
  ) {
    raw.attachments = cached.attachments;
    raw.references = cached.references;
    raw.inReplyTo = cached.inReplyTo;
    raw.detailsVersion = cached.detailsVersion;
    return;
  }

  const details = await extractMessageDetails(raw.id);
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

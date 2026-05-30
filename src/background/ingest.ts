import { classify } from "../classifier/pipeline";
import { extractFeatures } from "../classifier/features";
import { PINNED_KEY } from "../shared/categories";
import { log } from "../shared/log";
import { scanCidRefs } from "../spa/lib/srcdoc";
import type { AttachmentSummary, Category, RawMessage } from "../shared/types";
import { messageStillIn, resolveArchiveFolder } from "./archiveFolders";

const MESSAGE_DETAILS_VERSION = 2;

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

const folderIdOf = async (id: number): Promise<string> => {
  const msg = (await messenger.messages.get(id)) as messenger.messages.MessageHeader & {
    folder?: { id?: string };
  };
  return msg.folder?.id ?? "";
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
  const sourceFolderId = await folderIdOf(id);

  let archiveError: unknown = null;
  try {
    await messenger.messages.archive([id]);
  } catch (e) {
    archiveError = e;
    log.warn("archive", "messages.archive threw", { id, sourceFolderId, e: String(e) });
  }

  if (!(await messageStillIn(id, sourceFolderId))) return;

  log.warn("archive", "archive() did not move the message; attempting fallback", {
    id,
    sourceFolderId,
  });

  const resolved = await resolveArchiveFolder(id);
  if (!resolved) {
    throw new ArchiveFailedError(
      "No Archives folder configured for this account",
      archiveError,
    );
  }

  try {
    await messenger.messages.move(
      [id],
      resolved.archiveFolderId as unknown as messenger.folders.MailFolderId,
    );
  } catch (e) {
    log.warn("archive", "fallback move failed", {
      id,
      sourceFolderId,
      archiveFolderId: resolved.archiveFolderId,
      e: String(e),
    });
    throw new ArchiveFailedError("Move to Archives failed", e);
  }

  if (await messageStillIn(id, sourceFolderId)) {
    throw new ArchiveFailedError(
      "Move appeared to succeed but message still in source folder",
      archiveError,
    );
  }
}

export const trashMessage = async (id: number): Promise<void> => {
  try {
    const deleteMessages = messenger.messages.delete as unknown as (
      ids: number[],
      options?: { deletePermanently?: boolean },
    ) => Promise<void>;
    await deleteMessages([id], { deletePermanently: false });
  } catch (e) {
    log.warn("trash", "delete threw", { id, e: String(e) });
    throw new TrashFailedError("Delete failed", e);
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

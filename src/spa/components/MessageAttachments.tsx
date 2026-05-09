import { useState } from "react";
import { clsx } from "clsx";
import { log } from "../../shared/log";
import type { AttachmentSummary, RawMessage } from "../../shared/types";
import { Icon } from "./Icon";
import s from "./MessageAttachments.module.css";

export interface AttachmentRef {
  messageId: number;
  attachment: AttachmentSummary;
}

export const collectAttachments = (
  messages: readonly RawMessage[],
): AttachmentRef[] => {
  const refs: AttachmentRef[] = [];
  const seen = new Set<string>();
  const newestFirst = [...messages].sort((a, b) => b.date - a.date);
  for (const m of newestFirst) {
    for (const a of m.attachments ?? []) {
      const key = `${m.id}:${a.partName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ messageId: m.id, attachment: a });
    }
  }
  return refs;
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const iconForType = (contentType: string): string => {
  const ct = contentType.toLowerCase();
  if (ct === "text/x-moz-deleted") return "block";
  if (ct.startsWith("image/")) return "image";
  if (ct === "application/pdf") return "picture_as_pdf";
  if (ct.startsWith("video/")) return "videocam";
  if (ct.startsWith("audio/")) return "audiotrack";
  if (ct.includes("zip") || ct.includes("compressed") || ct.includes("tar")) {
    return "folder_zip";
  }
  if (
    ct.includes("spreadsheet") ||
    ct.includes("excel") ||
    ct === "text/csv"
  ) {
    return "table_chart";
  }
  if (ct.includes("word") || ct.includes("document")) return "description";
  if (ct.includes("presentation")) return "co_present";
  return "insert_drive_file";
};

const colorForType = (contentType: string): string => {
  const ct = contentType.toLowerCase();
  if (ct === "text/x-moz-deleted") return "#a3a3a3";
  if (ct === "application/pdf") return "#d93025";
  if (ct.startsWith("image/")) return "#1e8e3e";
  if (ct.startsWith("video/")) return "#9334e6";
  if (ct.startsWith("audio/")) return "#f29900";
  if (
    ct.includes("spreadsheet") ||
    ct.includes("excel") ||
    ct === "text/csv"
  ) {
    return "#0d652d";
  }
  if (ct.includes("word") || ct.includes("document")) return "#1a73e8";
  if (ct.includes("presentation")) return "#e8710a";
  return "#5f6368";
};

export const MessageAttachments = ({
  attachments,
  compact = false,
  limit,
}: {
  attachments: AttachmentRef[];
  compact?: boolean;
  limit?: number;
}) => {
  const [busy, setBusy] = useState<string | null>(null);

  if (!attachments.length) return null;

  const visible = limit ? attachments.slice(0, limit) : attachments;
  const overflow = attachments.length - visible.length;

  const openAttachment = async (ref: AttachmentRef): Promise<void> => {
    const a = ref.attachment;
    if (a.contentType === "text/x-moz-deleted") return;
    const key = `${ref.messageId}:${a.partName}`;
    if (busy) return;
    setBusy(key);
    let url: string | null = null;
    try {
      const file = await messenger.messages.getAttachmentFile(
        ref.messageId,
        a.partName,
      );
      url = URL.createObjectURL(file);
      window.open(url, "_blank");
    } catch (e) {
      log.warn("attachments", "open failed", e);
    } finally {
      setBusy(null);
      if (url) setTimeout(() => URL.revokeObjectURL(url!), 60_000);
    }
  };

  return (
    <div
      className={clsx(s.strip, compact && s.stripCompact)}
      onClick={(e) => e.stopPropagation()}
    >
      {visible.map((ref) => {
        const a = ref.attachment;
        const removed = a.contentType === "text/x-moz-deleted";
        const key = `${ref.messageId}:${a.partName}`;
        return (
          <button
            key={key}
            type="button"
            className={clsx(
              s.card,
              compact && s.cardCompact,
              removed && s.cardRemoved,
            )}
            onClick={() => void openAttachment(ref)}
            disabled={removed || busy === key}
            title={a.name}
          >
            <Icon
              name={iconForType(a.contentType)}
              className={clsx(s.icon, compact && s.iconCompact)}
              style={{ color: colorForType(a.contentType) }}
            />
            <div className={s.meta}>
              <div className={s.name}>{a.name}</div>
              {!compact && (
                <div className={s.size}>
                  {removed ? "(removed)" : formatSize(a.size)}
                </div>
              )}
            </div>
          </button>
        );
      })}
      {overflow > 0 && <span className={s.overflow}>+{overflow}</span>}
    </div>
  );
};

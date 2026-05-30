import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { createPortal } from "react-dom";
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

const attachmentKey = (ref: AttachmentRef): string =>
  `${ref.messageId}:${ref.attachment.partName}`;

const isImageAttachment = (ref: AttachmentRef): boolean =>
  ref.attachment.contentType.toLowerCase().startsWith("image/");

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
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const [objectUrls, setObjectUrls] = useState<Record<string, string>>({});
  const [hideGalleryUi, setHideGalleryUi] = useState(false);
  const urlsRef = useRef<Record<string, string>>({});
  const uiTimer = useRef<number | null>(null);
  const touchStartX = useRef(0);

  const visible = limit ? attachments.slice(0, limit) : attachments;
  const overflow = attachments.length - visible.length;
  const galleryImages = useMemo(
    () =>
      attachments.filter(
        (ref) =>
          isImageAttachment(ref) &&
          ref.attachment.contentType !== "text/x-moz-deleted",
      ),
    [attachments],
  );
  const currentImage =
    galleryIndex === null ? null : galleryImages[galleryIndex] ?? null;

  useEffect(() => {
    urlsRef.current = objectUrls;
  }, [objectUrls]);

  useEffect(() => {
    return () => {
      if (uiTimer.current) window.clearTimeout(uiTimer.current);
      Object.values(urlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (galleryIndex === null) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setGalleryIndex(null);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setGalleryIndex((idx) =>
          idx === null ? idx : (idx + 1) % galleryImages.length,
        );
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setGalleryIndex((idx) =>
          idx === null
            ? idx
            : (idx - 1 + galleryImages.length) % galleryImages.length,
        );
      }
    };

    window.addEventListener("keydown", onKeyDown);
    document.body.classList.add("attachmentGalleryOpen");

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("attachmentGalleryOpen");
    };
  }, [galleryIndex, galleryImages.length]);

  useEffect(() => {
    let cancelled = false;
    for (const ref of visible) {
      if (!isImageAttachment(ref)) continue;
      const key = attachmentKey(ref);
      if (objectUrls[key]) continue;

      void messenger.messages
        .getAttachmentFile(ref.messageId, ref.attachment.partName)
        .then((file) => {
          if (cancelled) return;
          const url = URL.createObjectURL(file);
          setObjectUrls((prev) => {
            if (prev[key]) {
              URL.revokeObjectURL(url);
              return prev;
            }
            return { ...prev, [key]: url };
          });
        })
        .catch((e) => {
          if (!cancelled) log.warn("attachments", "thumbnail load failed", e);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [objectUrls, visible]);

  if (!attachments.length) return null;

  const ensureObjectUrl = async (ref: AttachmentRef): Promise<string | null> => {
    const key = attachmentKey(ref);
    const existing = urlsRef.current[key] ?? objectUrls[key];
    if (existing) return existing;

    try {
      const file = await messenger.messages.getAttachmentFile(
        ref.messageId,
        ref.attachment.partName,
      );
      const loadedWhileFetching = urlsRef.current[key];
      if (loadedWhileFetching) return loadedWhileFetching;

      const url = URL.createObjectURL(file);
      let finalUrl = url;
      setObjectUrls((prev) => {
        if (prev[key]) {
          finalUrl = prev[key];
          URL.revokeObjectURL(url);
          return prev;
        }
        return { ...prev, [key]: url };
      });
      return finalUrl;
    } catch (e) {
      log.warn("attachments", "load failed", e);
      return null;
    }
  };

  const scheduleHideGalleryUi = () => {
    setHideGalleryUi(false);
    if (uiTimer.current) window.clearTimeout(uiTimer.current);
    uiTimer.current = window.setTimeout(() => {
      setHideGalleryUi(true);
    }, 2500);
  };

  const openGallery = async (ref: AttachmentRef): Promise<void> => {
    const index = galleryImages.findIndex(
      (imgRef) => attachmentKey(imgRef) === attachmentKey(ref),
    );
    if (index === -1) return;
    setGalleryIndex(index);
    scheduleHideGalleryUi();
    void ensureObjectUrl(ref);
    void Promise.all(galleryImages.map((img) => ensureObjectUrl(img)));
  };

  const moveGallery = (direction: 1 | -1) => {
    setGalleryIndex((idx) =>
      idx === null
        ? idx
        : (idx + direction + galleryImages.length) % galleryImages.length,
    );
    scheduleHideGalleryUi();
  };

  const openCurrentImageExternal = async (): Promise<void> => {
    if (!currentImage) return;
    const url = await ensureObjectUrl(currentImage);
    if (url) window.open(url, "_blank");
  };

  const openAttachment = async (ref: AttachmentRef): Promise<void> => {
    const a = ref.attachment;
    if (a.contentType === "text/x-moz-deleted") return;
    if (isImageAttachment(ref)) {
      await openGallery(ref);
      return;
    }
    const key = attachmentKey(ref);
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
        const key = attachmentKey(ref);
        const objectUrl = objectUrls[key];
        const image = !removed && isImageAttachment(ref);
        return (
          <button
            key={key}
            type="button"
            className={clsx(
              s.card,
              compact && s.cardCompact,
              image && s.imageCard,
              image && compact && s.imageCardCompact,
              removed && s.cardRemoved,
            )}
            onClick={() => void openAttachment(ref)}
            disabled={removed || busy === key}
            title={a.name}
          >
            {image && objectUrl ? (
              <img
                className={s.coverImage}
                src={objectUrl}
                alt=""
              />
            ) : image ? (
              <Icon
                name="image"
                className={s.imagePlaceholderIcon}
                style={{ color: colorForType(a.contentType) }}
              />
            ) : (
              <Icon
                name={iconForType(a.contentType)}
                className={clsx(s.icon, compact && s.iconCompact)}
                style={{ color: colorForType(a.contentType) }}
              />
            )}
            {!image && (
              <div className={s.meta}>
                <div className={s.name}>{a.name}</div>
                {!compact && (
                  <div className={s.size}>
                    {removed ? "(removed)" : formatSize(a.size)}
                  </div>
                )}
              </div>
            )}
          </button>
        );
      })}
      {overflow > 0 && <span className={s.overflow}>+{overflow}</span>}
      {currentImage && galleryIndex !== null &&
        createPortal(
          <div
          className={clsx(s.gallery, hideGalleryUi && s.galleryHideUi)}
          role="dialog"
          aria-modal="true"
          aria-label="Attachment image gallery"
          onMouseMove={scheduleHideGalleryUi}
          onClick={() => setGalleryIndex(null)}
          onTouchStart={(e) => {
            touchStartX.current = e.changedTouches[0]?.screenX ?? 0;
            scheduleHideGalleryUi();
          }}
          onTouchEnd={(e) => {
            const endX = e.changedTouches[0]?.screenX ?? touchStartX.current;
            const distance = endX - touchStartX.current;
            if (Math.abs(distance) > 50) moveGallery(distance > 0 ? -1 : 1);
          }}
          >
            <div className={s.announcer} aria-live="polite" aria-atomic="true">
              Image {galleryIndex + 1} of {galleryImages.length}
            </div>
            <button
              type="button"
              className={clsx(s.galleryButton, s.galleryClose)}
              aria-label="Close gallery"
              title="Close"
              onClick={(e) => {
                e.stopPropagation();
                setGalleryIndex(null);
              }}
            >
              <Icon name="close" />
            </button>
            <button
              type="button"
              className={clsx(s.galleryButton, s.galleryOpen)}
              aria-label="Open image in new tab"
              title="Open image in new tab"
              onClick={(e) => {
                e.stopPropagation();
                void openCurrentImageExternal();
              }}
            >
              <Icon name="open_in_new" />
            </button>
            {galleryImages.length > 1 && (
              <>
                <button
                  type="button"
                  className={clsx(s.galleryButton, s.galleryPrev)}
                  aria-label="Previous image"
                  title="Previous image"
                  onClick={(e) => {
                    e.stopPropagation();
                    moveGallery(-1);
                  }}
                >
                  <Icon name="chevron_left" />
                </button>
                <button
                  type="button"
                  className={clsx(s.galleryButton, s.galleryNext)}
                  aria-label="Next image"
                  title="Next image"
                  onClick={(e) => {
                    e.stopPropagation();
                    moveGallery(1);
                  }}
                >
                  <Icon name="chevron_right" />
                </button>
              </>
            )}
            <div className={s.galleryStage}>
              {objectUrls[attachmentKey(currentImage)] ? (
                <img
                  className={s.galleryImage}
                  src={objectUrls[attachmentKey(currentImage)]}
                  alt={currentImage.attachment.name}
                  onClick={(e) => {
                    e.stopPropagation();
                    setHideGalleryUi((prev) => !prev);
                  }}
                />
              ) : (
                <div className={s.galleryLoading}>Loading image...</div>
              )}
            </div>
            <div className={s.galleryCaption}>
              <span className={s.galleryName}>{currentImage.attachment.name}</span>
              <span>
                {galleryIndex + 1} / {galleryImages.length}
              </span>
            </div>
            {galleryImages.length > 1 && (
              <div className={s.galleryThumbs} onClick={(e) => e.stopPropagation()}>
                {galleryImages.map((ref, index) => {
                  const key = attachmentKey(ref);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={clsx(
                        s.galleryThumbButton,
                        index === galleryIndex && s.galleryThumbActive,
                      )}
                      aria-label={`View image ${index + 1} of ${galleryImages.length}`}
                      aria-current={index === galleryIndex ? "true" : undefined}
                      title={ref.attachment.name}
                      onClick={() => {
                        setGalleryIndex(index);
                        scheduleHideGalleryUi();
                        void ensureObjectUrl(ref);
                      }}
                    >
                      {objectUrls[key] ? (
                        <img src={objectUrls[key]} alt="" />
                      ) : (
                        <Icon name="image" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
};

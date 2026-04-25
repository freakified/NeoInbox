import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RawMessage } from "../../shared/types";
import { buildSrcdoc, extractHtmlBody, extractTextBody } from "../lib/srcdoc";

export const MessageBody = ({
  message: m,
  accentColor,
}: {
  message: RawMessage;
  accentColor?: string;
}) => {
  const [rawHtml, setRawHtml] = useState<string | null>(null);
  const [isPlainText, setIsPlainText] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [iframeHeight, setIframeHeight] = useState(200);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    messenger.messages.getFull(m.id).then((part) => {
      const html = extractHtmlBody(part);
      if (html) {
        setRawHtml(html);
        setIsPlainText(false);
      } else {
        setRawHtml(extractTextBody(part) ?? "");
        setIsPlainText(true);
      }
    });
  }, [m.id]);

  useEffect(() => () => roRef.current?.disconnect(), []);

  const measureHeight = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    roRef.current?.disconnect();
    const measure = () => setIframeHeight(doc.documentElement.scrollHeight + 24);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(doc.documentElement);
    roRef.current = ro;
  }, []);

  const srcdoc = useMemo(
    () =>
      rawHtml !== null ? buildSrcdoc(rawHtml, showImages || isPlainText) : "",
    [rawHtml, showImages, isPlainText],
  );

  return (
    <div
      className={accentColor ? "bg-neutral-50 border-l-4" : "bg-neutral-50"}
      style={accentColor ? { borderLeftColor: accentColor } : {}}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-neutral-200 text-xs text-neutral-500">
        <span>
          {m.author} &mdash; {new Date(m.date).toLocaleString()}
        </span>
        <div className="flex gap-2">
          {!showImages && !isPlainText && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowImages(true);
              }}
              className="px-2 py-0.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700"
            >
              Load images
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              void messenger.messageDisplay.open({
                messageId: m.id,
                location: "tab",
              });
            }}
            className="px-2 py-0.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700"
          >
            Open in Thunderbird ↗
          </button>
        </div>
      </div>
      {rawHtml === null ? (
        <div className="px-4 py-6 text-sm text-neutral-400">Loading…</div>
      ) : (
        <iframe
          ref={iframeRef}
          sandbox="allow-same-origin"
          srcDoc={srcdoc}
          onLoad={measureHeight}
          style={{
            width: "100%",
            height: iframeHeight,
            border: "none",
            display: "block",
          }}
          title={m.subject}
        />
      )}
    </div>
  );
}

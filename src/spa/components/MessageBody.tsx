import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RawMessage } from "../../shared/types";
import { buildSrcdoc, extractHtmlBody, extractTextBody } from "../lib/srcdoc";
import s from "./MessageBody.module.css";

export const MessageBody = ({
  message: m,
}: {
  message: RawMessage;
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
    <div className={s.body}>
      <div className={s.toolbar}>
        <span>
          {m.author} &mdash; {new Date(m.date).toLocaleString()}
        </span>
        <div className={s.toolbarActions}>
          {!showImages && !isPlainText && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowImages(true);
              }}
              className={s.toolbarBtn}
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
            className={s.toolbarBtn}
          >
            Open in Thunderbird ↗
          </button>
        </div>
      </div>
      {rawHtml === null ? (
        <div className={s.loading}>Loading…</div>
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
};

import { useEffect, useMemo, useRef, useState } from "react";
import type { RawMessage } from "../../shared/types";
import { useIframeAutoHeight } from "../lib/useIframeAutoHeight";
import { buildSrcdoc, extractHtmlBody, extractTextBody } from "../lib/srcdoc";
import s from "./MessageBody.module.css";

export const MessageBody = ({
  message: m,
}: {
  message: RawMessage;
}) => {
  const [rawHtml, setRawHtml] = useState<string | null>(null);
  const [isPlainText, setIsPlainText] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { height, onLoad } = useIframeAutoHeight(iframeRef);

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

  const srcdoc = useMemo(
    () => (rawHtml !== null ? buildSrcdoc(rawHtml, isPlainText) : ""),
    [rawHtml, isPlainText],
  );

  return (
    <div className={s.body}>
      {rawHtml === null ? (
        <div className={s.loading}>Loading…</div>
      ) : (
        <iframe
          ref={iframeRef}
          sandbox="allow-same-origin"
          srcDoc={srcdoc}
          onLoad={onLoad}
          style={{
            width: "100%",
            height,
            border: "none",
            display: "block",
            boxSizing: "border-box",
          }}
          title={m.subject}
        />
      )}
    </div>
  );
};

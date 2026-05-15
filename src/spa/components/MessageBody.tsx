import { useEffect, useMemo, useRef, useState } from "react";
import { parseSender } from "../../shared/senders";
import type { RawMessage } from "../../shared/types";
import { useIframeAutoHeight } from "../lib/useIframeAutoHeight";
import {
  buildTextSrcdoc,
  buildSrcdoc,
  extractHtmlBody,
  extractTextBody,
  hasBlockedRemoteImages,
} from "../lib/srcdoc";
import { translateMessageToEnglish } from "../lib/translation";
import {
  getRemoteImagePolicy,
  isTrustedImageSender,
  subscribeTrustedImageSenders,
  trustImageSender,
} from "../lib/remoteImagePrefs";
import s from "./MessageBody.module.css";

export const MessageBody = ({
  message: m,
  translationRequest = 0,
}: {
  message: RawMessage;
  translationRequest?: number;
}) => {
  const [rawHtml, setRawHtml] = useState<string | null>(null);
  const [isPlainText, setIsPlainText] = useState(false);
  const [showImagesForMessage, setShowImagesForMessage] = useState(false);
  const [remoteImagePrefsVersion, setRemoteImagePrefsVersion] = useState(0);
  const [translationStatus, setTranslationStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [translationError, setTranslationError] = useState("");
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { height, onLoad } = useIframeAutoHeight(iframeRef);
  const senderEmail = useMemo(() => {
    const email = parseSender(m.author).email;
    return email.includes("@") ? email : "";
  }, [m.author]);

  useEffect(() => {
    let cancelled = false;
    setRawHtml(null);
    setShowImagesForMessage(false);

    messenger.messages.getFull(m.id).then((part) => {
      if (cancelled) return;
      const html = extractHtmlBody(part);
      if (html) {
        setRawHtml(html);
        setIsPlainText(false);
      } else {
        setRawHtml(extractTextBody(part) ?? "");
        setIsPlainText(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [m.id]);

  useEffect(() => {
    setTranslationStatus("idle");
    setTranslationError("");
    setTranslatedText(null);
    setShowTranslation(false);
  }, [m.id]);

  useEffect(
    () =>
      subscribeTrustedImageSenders(() => {
        setRemoteImagePrefsVersion((version) => version + 1);
      }),
    [],
  );

  const remoteImagePolicy = useMemo(
    () => getRemoteImagePolicy(),
    [remoteImagePrefsVersion],
  );
  const senderAlwaysAllowed = useMemo(
    () => isTrustedImageSender(senderEmail),
    [senderEmail, remoteImagePrefsVersion],
  );

  const hasBlockedImages = useMemo(
    () => rawHtml !== null && !isPlainText && hasBlockedRemoteImages(rawHtml),
    [isPlainText, rawHtml],
  );
  const showImages =
    isPlainText ||
    remoteImagePolicy === "always" ||
    (remoteImagePolicy === "senders" && (showImagesForMessage || senderAlwaysAllowed));

  const srcdoc = useMemo(
    () => (rawHtml !== null ? buildSrcdoc(rawHtml, showImages) : ""),
    [rawHtml, showImages],
  );
  const translatedSrcdoc = useMemo(
    () => (translatedText !== null ? buildTextSrcdoc(translatedText) : ""),
    [translatedText],
  );
  const activeSrcdoc = showTranslation && translatedSrcdoc ? translatedSrcdoc : srcdoc;

  const requestTranslation = () => {
    setTranslationStatus("loading");
    setTranslationError("");
    translateMessageToEnglish(m.id)
      .then((record) => {
        setTranslatedText(record.translatedText);
        setShowTranslation(true);
        setTranslationStatus("done");
      })
      .catch((e) => {
        setTranslationError(String((e as Error)?.message ?? e));
        setTranslationStatus("error");
      });
  };

  useEffect(() => {
    if (translationRequest <= 0) return;
    requestTranslation();
  }, [translationRequest]);

  return (
    <div className={s.body}>
      {rawHtml === null ? (
        <div className={s.loading}>Loading…</div>
      ) : (
        <>
          {hasBlockedImages && !showImages && (
            <div className={s.imageNotice}>
              <span>
                {remoteImagePolicy === "never"
                  ? "Remote images are blocked in Settings."
                  : "Images are not displayed."}
              </span>
              {remoteImagePolicy === "senders" && (
                <>
                  <button
                    className={s.noticeButton}
                    type="button"
                    onClick={() => setShowImagesForMessage(true)}
                  >
                    Display images below
                  </button>
                  {senderEmail && (
                    <button
                      className={s.noticeButton}
                      type="button"
                      onClick={() => {
                        trustImageSender(senderEmail);
                        setShowImagesForMessage(true);
                      }}
                    >
                      Always display images from {senderEmail}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {translationStatus !== "idle" && (
            <div className={s.imageNotice}>
              <span>
                {translationStatus === "loading"
                  ? "Translating to English..."
                  : translationStatus === "done"
                    ? "Translated to English."
                    : translationError || "Couldn't translate this message."}
              </span>
              {translationStatus === "done" && translatedText && (
                <button
                  className={s.noticeButton}
                  type="button"
                  onClick={() => setShowTranslation((showing) => !showing)}
                >
                  {showTranslation ? "Show original" : "Show translation"}
                </button>
              )}
              {translationStatus === "error" && (
                <button className={s.noticeButton} type="button" onClick={requestTranslation}>
                  Retry
                </button>
              )}
            </div>
          )}
          <iframe
            ref={iframeRef}
            sandbox="allow-same-origin"
            srcDoc={activeSrcdoc}
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
        </>
      )}
    </div>
  );
};

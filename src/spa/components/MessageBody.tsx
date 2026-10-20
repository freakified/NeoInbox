import { useEffect, useMemo, useRef, useState } from "react";
import { liveTbId } from "../../shared/liveMessage";
import { parseSender } from "../../shared/senders";
import type { RawMessage } from "../../shared/types";
import { useMailStore } from "../../store/mailStore";
import { useIframeAutoHeight } from "../lib/useIframeAutoHeight";
import {
  buildComposedSrcdoc,
  buildTextSrcdoc,
  buildSrcdoc,
  extractHtmlBody,
  extractTextBody,
  hasBlockedRemoteImages,
} from "../lib/srcdoc";
import {
  targetLanguageLabel,
  translateMessage,
  translationTargetLabel,
  TranslationSetupError,
} from "../lib/translation";
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
  onTranslatedSubject,
  placeholder,
}: {
  message: RawMessage;
  /** Shown instead of "Loading…" until the body arrives, e.g. the reply just sent. */
  placeholder?: { text: string; html?: string };
  translationRequest?: number;
  onTranslatedSubject?: (subject: string) => void;
}) => {
  const [rawHtml, setRawHtml] = useState<string | null>(null);
  const [isPlainText, setIsPlainText] = useState(false);
  const [showImagesForMessage, setShowImagesForMessage] = useState(false);
  const [remoteImagePrefsVersion, setRemoteImagePrefsVersion] = useState(0);
  const [translationStatus, setTranslationStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [translationError, setTranslationError] = useState("");
  const [translationNeedsSetup, setTranslationNeedsSetup] = useState(false);
  const openBundleSettings = useMailStore((st) => st.openBundleSettings);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [translatedSubject, setTranslatedSubject] = useState("");
  const [translatedBodyType, setTranslatedBodyType] = useState<"text" | "html">("text");
  const [showTranslation, setShowTranslation] = useState(false);
  const [translationLabel, setTranslationLabel] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const senderEmail = useMemo(() => {
    const email = parseSender(m.author).email;
    return email.includes("@") ? email : "";
  }, [m.author]);

  useEffect(() => {
    let cancelled = false;
    setRawHtml(null);
    setShowImagesForMessage(false);

    void (async () => {
      // Never render a body fetched by an unverified id: stale cached ids can
      // belong to a different message entirely.
      const liveId = await liveTbId(m);
      if (cancelled) return;
      if (liveId === null) {
        setRawHtml("This message could not be found — it may have been moved or deleted.");
        setIsPlainText(true);
        return;
      }
      try {
        const part = await messenger.messages.getFull(liveId);
        if (cancelled) return;
        const html = extractHtmlBody(part);
        if (html) {
          setRawHtml(html);
          setIsPlainText(false);
        } else {
          setRawHtml(extractTextBody(part) ?? "");
          setIsPlainText(true);
        }
      } catch {
        if (cancelled) return;
        setRawHtml("This message's content isn't available offline yet.");
        setIsPlainText(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [m.key]);

  useEffect(() => {
    setTranslationStatus("idle");
    setTranslationError("");
    setTranslatedText(null);
    setTranslatedSubject("");
    setTranslatedBodyType("text");
    setShowTranslation(false);
    onTranslatedSubject?.("");
  }, [m.key]);

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
    () => {
      if (translatedText === null) return "";
      return translatedBodyType === "html"
        ? buildSrcdoc(translatedText, showImages)
        : buildTextSrcdoc(translatedText);
    },
    [showImages, translatedBodyType, translatedText],
  );
  const placeholderSrcdoc = useMemo(
    () => (placeholder ? buildComposedSrcdoc(placeholder.text, placeholder.html) : ""),
    [placeholder],
  );
  const activeSrcdoc =
    rawHtml === null ? placeholderSrcdoc : showTranslation && translatedSrcdoc ? translatedSrcdoc : srcdoc;
  const { height, onLoad } = useIframeAutoHeight(iframeRef, activeSrcdoc);

  const requestTranslation = () => {
    setTranslationStatus("loading");
    setTranslationError("");
    setTranslationLabel(translationTargetLabel());
    translateMessage(m)
      .then((record) => {
        setTranslationLabel(targetLanguageLabel(record.targetLanguage));
        const subject = record.translatedSubject ?? "";
        setTranslatedText(record.translatedText);
        setTranslatedSubject(subject);
        setTranslatedBodyType(record.bodyType ?? "text");
        onTranslatedSubject?.(subject);
        setShowTranslation(true);
        setTranslationStatus("done");
      })
      .catch((e) => {
        setTranslationError(String((e as Error)?.message ?? e));
        setTranslationNeedsSetup(e instanceof TranslationSetupError);
        setTranslationStatus("error");
      });
  };

  useEffect(() => {
    if (translationRequest <= 0) return;
    requestTranslation();
  }, [translationRequest]);

  const toggleTranslation = () => {
    setShowTranslation((showing) => {
      const next = !showing;
      onTranslatedSubject?.(next ? translatedSubject : "");
      return next;
    });
  };

  return (
    <div className={s.body}>
      {rawHtml === null && !placeholderSrcdoc ? (
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
                  ? `Translating to ${translationLabel}…`
                  : translationStatus === "done"
                    ? `Translated to ${translationLabel}.`
                    : translationError || "Couldn't translate this message."}
              </span>
              {translationStatus === "done" && translatedText && (
                <button
                  className={s.noticeButton}
                  type="button"
                  onClick={toggleTranslation}
                >
                  {showTranslation ? "Show original" : "Show translation"}
                </button>
              )}
              {translationStatus === "error" &&
                (translationNeedsSetup ? (
                  <button
                    className={s.noticeButton}
                    type="button"
                    onClick={() => openBundleSettings({ pane: "translation" })}
                  >
                    Open translation settings
                  </button>
                ) : (
                  <button className={s.noticeButton} type="button" onClick={requestTranslation}>
                    Retry
                  </button>
                ))}
            </div>
          )}
          <iframe
            ref={iframeRef}
            className={s.frame}
            sandbox="allow-same-origin"
            srcDoc={activeSrcdoc}
            onLoad={onLoad}
            style={{
              height,
            }}
            title={m.subject}
          />
        </>
      )}
    </div>
  );
};

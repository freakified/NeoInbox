import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

export const useIframeAutoHeight = (iframeRef: RefObject<HTMLIFrameElement | null>) => {
  const [height, setHeight] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastHeightRef = useRef(0);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const onLoad = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;

    const apply = () => {
      frameRef.current = null;
      const next = doc.body.scrollHeight;
      if (next === lastHeightRef.current) return;
      lastHeightRef.current = next;
      setHeight(next);
    };

    const schedule = () => {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(apply);
    };

    observerRef.current?.disconnect();
    const observer = new ResizeObserver(schedule);
    observer.observe(doc.body);
    observerRef.current = observer;

    const fonts = doc.fonts;
    if (fonts && typeof fonts.ready?.then === "function") {
      fonts.ready.then(schedule).catch(schedule);
    }
    schedule();
  }, [iframeRef]);

  return { height, onLoad };
};

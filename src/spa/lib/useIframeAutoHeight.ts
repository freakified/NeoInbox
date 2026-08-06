import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

// Measuring only on the iframe's `load` event leaves a body with remote images at
// height 0 until the slowest image has finished downloading — the frame reads as
// blank even though its text was parsed and painted long before. So we start
// measuring as soon as the srcdoc document exists and keep following it upward as
// images and fonts land.
const POLL_MS = 50;
const POLL_TIMEOUT_MS = 20_000;

export const useIframeAutoHeight = (
  iframeRef: RefObject<HTMLIFrameElement | null>,
  srcdoc: string,
) => {
  const [height, setHeight] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const observedDocRef = useRef<Document | null>(null);
  const frameRef = useRef<number | null>(null);
  const pollRef = useRef<number | null>(null);
  const lastHeightRef = useRef(0);

  const apply = useCallback(() => {
    frameRef.current = null;
    const body = iframeRef.current?.contentDocument?.body;
    if (!body) return;
    const next = body.scrollHeight;
    if (next === lastHeightRef.current) return;
    lastHeightRef.current = next;
    setHeight(next);
  }, [iframeRef]);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(apply);
  }, [apply]);

  // Re-point the observer whenever the iframe swaps in a new document (about:blank
  // first, then the srcdoc), then measure.
  const sync = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;
    if (observedDocRef.current !== doc) {
      observerRef.current?.disconnect();
      const observer = new ResizeObserver(schedule);
      observer.observe(doc.body);
      observerRef.current = observer;
      observedDocRef.current = doc;
      doc.fonts?.ready.then(schedule).catch(schedule);
    }
    schedule();
  }, [iframeRef, schedule]);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => {
    if (!srcdoc) return;
    sync();
    const startedAt = Date.now();
    pollRef.current = window.setInterval(() => {
      sync();
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) stopPolling();
    }, POLL_MS);
    return stopPolling;
  }, [srcdoc, stopPolling, sync]);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (pollRef.current !== null) clearInterval(pollRef.current);
    },
    [],
  );

  // Everything has settled: take a final measurement and stop the poll — the
  // ResizeObserver covers any later reflow on its own.
  const onLoad = useCallback(() => {
    sync();
    stopPolling();
  }, [stopPolling, sync]);

  return { height, onLoad };
};

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Distance from the top of the document, ignoring CSS transforms — framer's
 * layout animations move rows with transforms mid-flight, and anchoring to
 * those in-between positions would make the page lurch.
 */
const documentTop = (el: HTMLElement): number => {
  let top = 0;
  for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) {
    top += node.offsetTop;
  }
  return top;
};

/**
 * Keeps the element (the open conversation) at the same spot on screen when
 * the stream reorders around it — e.g. a reply you just sent bumps the thread
 * to the top of Today, or mail above it is marked done. Without this the page
 * stays put and the conversation flies off. Re-anchors whenever `key` changes
 * (a different conversation opened).
 */
export const useScrollAnchor = (
  ref: RefObject<HTMLElement | null>,
  key: string | null,
): void => {
  const anchor = useRef<{ key: string; viewportTop: number } | null>(null);

  const record = () => {
    const el = ref.current;
    anchor.current =
      el && key ? { key, viewportTop: documentTop(el) - window.scrollY } : null;
  };

  // Runs after every render: if the element moved since last recorded, scroll
  // by the same amount before the browser paints.
  useLayoutEffect(() => {
    const el = ref.current;
    const prev = anchor.current;
    if (el && key && prev?.key === key) {
      const delta = documentTop(el) - window.scrollY - prev.viewportTop;
      if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: "instant" });
    }
    record();
  });

  // The user's own scrolling moves the anchor along with it.
  useEffect(() => {
    window.addEventListener("scroll", record, { passive: true });
    return () => window.removeEventListener("scroll", record);
  });
};

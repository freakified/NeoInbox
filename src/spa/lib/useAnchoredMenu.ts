import { type RefObject, useLayoutEffect, useState } from "react";

const GAP = 6;
const MARGIN = 8;

/**
 * Fixed-position style for a portaled menu pinned under its trigger,
 * right-aligned. When there isn't room below it flips above the trigger, and
 * when neither side fits it slides up over the trigger to stay on screen,
 * scrolling only if it's taller than the viewport.
 *
 * `layoutKey` re-measures when the menu swaps content (e.g. a submenu view),
 * since a height-capped box may not resize when its content does.
 */
export const useAnchoredMenu = (
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  layoutKey?: unknown,
): React.CSSProperties => {
  const [style, setStyle] = useState<React.CSSProperties>({});

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!rect || !menu) return;
      const right = window.innerWidth - rect.right;
      // scrollHeight is the natural height even while maxHeight caps the box.
      const height = menu.scrollHeight + menu.offsetHeight - menu.clientHeight;
      const below = window.innerHeight - rect.bottom - GAP - MARGIN;
      const above = rect.top - GAP - MARGIN;
      const fit = window.innerHeight - 2 * MARGIN;
      const top =
        height <= below ? rect.bottom + GAP
        : height <= above ? rect.top - GAP - height
        // Neither side fits: cover the trigger rather than scroll a short menu.
        : Math.max(MARGIN, window.innerHeight - MARGIN - height);
      setStyle({ top, right, maxHeight: fit, overflowY: "auto" });
    };
    update();
    const observer = new ResizeObserver(update);
    if (menuRef.current) observer.observe(menuRef.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, triggerRef, menuRef, layoutKey]);

  return style;
};

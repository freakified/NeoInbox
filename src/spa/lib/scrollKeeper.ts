import { visualElementStore } from "framer-motion";

/**
 * The one place that moves the page's scroll position.
 *
 * Google Inbox kept whatever you were working on in view: opening a
 * conversation glided it on screen, and when the stream changed around it
 * (mail above marked done, a reply re-sorting the thread, new mail arriving)
 * it stayed put. We do the same by holding an *anchor* — a row, by its
 * `data-row-key` — at a fixed distance from the top of the viewport, and
 * scrolling to cancel out any layout change that would move it.
 *
 * Which row is the anchor:
 *  - the open conversation (or the j/k cursor row) while it's on screen;
 *  - otherwise whichever row is at the top of the viewport, like the browser's
 *    own scroll anchoring (switched off in CSS, since two correctors fight).
 * When the anchor itself goes away (done, snoozed, trashed), the row after it
 * takes its place — or the top of the viewport, if the anchor's top was
 * scrolled out of sight — so you never end up somewhere unrelated.
 *
 * `reveal` additionally eases the anchor into view, re-aiming every frame: an
 * opening card is still growing (expand animation, email iframe sizing itself)
 * and the card that was open before is still collapsing, so a target measured
 * once up front is wrong by the time the scroll gets there.
 *
 * Positions are layout positions (offsetTop), never getBoundingClientRect:
 * framer's layout animations move rows with transforms mid-flight, and
 * anchoring to those would chase the animation.
 */

const KEY_ATTR = "data-row-key";
/** Space kept between the fixed app header and a revealed row. */
const TOP_MARGIN = 16;
const BOTTOM_MARGIN = 16;
/** How long a reveal keeps re-aiming at a card that's still growing. */
const REVEAL_MS = 1200;
/** Time constant of the reveal's ease-out; ~4x this to settle. */
const REVEAL_TAU_MS = 70;

type Anchor = {
  key: string;
  /** Desired layout top relative to the viewport. */
  offset: number;
  /** Chosen on purpose (open card, cursor) rather than "whatever is at the top". */
  pinned: boolean;
  next: string | null;
  prev: { key: string; offset: number } | null;
};

let anchor: Anchor | null = null;
let reveal: { until: number; last: number } | null = null;
let raf = 0;
/** scrollY right after our last scroll, to tell the user's scrolling apart. */
let ourScrollY = -1;
/**
 * Total distance we've scrolled to hold the anchor. Framer measures layout
 * animations in page coordinates, so it would read a compensating scroll as
 * every row having moved and animate them all back from where they were;
 * subtracting this from the scroll framer sees makes it animate in the frame
 * the user actually sees instead.
 */
let compensation = 0;
let topInset: () => number = () => 0;
let patchedRoot = false;

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const visibleTop = () => topInset() + TOP_MARGIN;
const visibleBottom = () => window.innerHeight - BOTTOM_MARGIN;

const layoutTop = (el: HTMLElement): number => {
  let top = 0;
  for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) {
    top += node.offsetTop;
  }
  return top;
};

const viewportTop = (el: HTMLElement) => layoutTop(el) - window.scrollY;

const keyedRows = () => Array.from(document.querySelectorAll<HTMLElement>(`[${KEY_ATTR}]`));

// Keys carry thread ids, which can contain characters a selector can't
// express (NULs), so look them up by comparison rather than querySelector.
const find = (key: string): HTMLElement | null =>
  keyedRows().find((el) => el.getAttribute(KEY_ATTR) === key) ?? null;

export const rowKeyOf = (el: Element | null): string | null =>
  el?.closest(`[${KEY_ATTR}]`)?.getAttribute(KEY_ATTR) ?? null;

const isOnScreen = (el: HTMLElement) => {
  const top = viewportTop(el);
  return top + el.offsetHeight > topInset() && top < window.innerHeight;
};

/** The row at the top of the viewport: the first one whose bottom is below the header. */
const topmostVisibleRow = (): HTMLElement | null => {
  const inset = topInset();
  // Innermost rows first, so an open bundle anchors on the thread at the top
  // of the screen rather than on the bundle's top edge far above.
  let best: HTMLElement | null = null;
  for (const el of keyedRows()) {
    const top = viewportTop(el);
    if (top + el.offsetHeight <= inset) continue;
    if (top >= window.innerHeight) break;
    if (!best || best.contains(el)) best = el;
    else break;
  }
  return best;
};

const scrollToY = (y: number) => {
  window.scrollTo({ top: y, behavior: "instant" });
  ourScrollY = window.scrollY;
};

/** Note the anchor's neighbours, so its successor is known before it's removed. */
const recordNeighbours = (el: HTMLElement) => {
  if (!anchor) return;
  const rows = keyedRows();
  const index = rows.indexOf(el);
  const next = rows.slice(index + 1).find((r) => !el.contains(r));
  const prev = rows.slice(0, index).reverse().find((r) => !r.contains(el));
  anchor.next = next?.getAttribute(KEY_ATTR) ?? null;
  anchor.prev = prev ? { key: prev.getAttribute(KEY_ATTR)!, offset: viewportTop(prev) } : null;
};

const setAnchor = (el: HTMLElement, pinned: boolean, offset = viewportTop(el)) => {
  anchor = { key: el.getAttribute(KEY_ATTR)!, offset, pinned, next: null, prev: null };
  recordNeighbours(el);
};

/** Re-pick the anchor from what's on screen now (after the user scrolls). */
const repick = () => {
  if (anchor?.pinned) {
    const el = find(anchor.key);
    if (el && isOnScreen(el)) {
      anchor.offset = viewportTop(el);
      recordNeighbours(el);
      return;
    }
  }
  const el = topmostVisibleRow();
  if (el) setAnchor(el, false);
  else anchor = null;
};

/** Where a revealed row should sit: wholly in view, or top under the header if it can't fit. */
const revealOffset = (el: HTMLElement, current: number): number => {
  const top = visibleTop();
  const bottom = visibleBottom();
  const height = el.offsetHeight;
  if (height > bottom - top || current < top) return top;
  if (current + height > bottom) return bottom - height;
  return current;
};

/** Scroll so the anchor sits at its offset again. Safe to call any time. */
const sync = () => {
  if (!anchor) return;
  let el = find(anchor.key);
  if (!el) {
    // The anchor left the stream: whatever followed it takes its place, but
    // never above the fold — after done-ing a long email you've scrolled
    // into, the next one shows up where you're looking.
    const { next, prev, offset, pinned } = anchor;
    const successor = next ? find(next) : null;
    const fallback = !successor && prev ? find(prev.key) : null;
    if (successor) setAnchor(successor, pinned, Math.max(offset, visibleTop()));
    else if (fallback) setAnchor(fallback, pinned, prev!.offset);
    else {
      anchor = null;
      return;
    }
    el = successor ?? fallback!;
  }

  // At the very top of the page, let new mail push the list down rather
  // than slip in unseen above — unless something is deliberately held.
  if (!anchor.pinned && window.scrollY <= 0) {
    anchor.offset = viewportTop(el);
    recordNeighbours(el);
    return;
  }

  const drift = viewportTop(el) - anchor.offset;
  if (Math.abs(drift) >= 0.5) {
    const before = window.scrollY;
    scrollToY(before + drift);
    compensation -= window.scrollY - before;
  }
  // Clamped at either end of the page: hold where it actually landed.
  anchor.offset = viewportTop(el);
  recordNeighbours(el);
};

const tick = (now: number) => {
  raf = 0;
  if (reveal && anchor) {
    const el = find(anchor.key);
    if (!el || now > reveal.until) reveal = null;
    else {
      const target = revealOffset(el, anchor.offset);
      const dt = Math.min(now - reveal.last, 50);
      reveal.last = now;
      const step = reducedMotion() ? 1 : 1 - Math.exp(-dt / REVEAL_TAU_MS);
      anchor.offset += (target - anchor.offset) * step;
    }
  }
  sync();
  if (reveal) raf = requestAnimationFrame(tick);
};

const startLoop = () => {
  if (!raf) raf = requestAnimationFrame(tick);
};

/**
 * Hook framer's document-level projection node: hand it the scroll position
 * minus our compensation, and settle the anchor right before it measures a
 * layout change so its animations start from the corrected positions.
 */
const patchFramer = () => {
  if (patchedRoot) return;
  const sample = document.querySelector(`[${KEY_ATTR}]`);
  const root = sample ? visualElementStore.get(sample)?.projection?.root : undefined;
  if (!root) return;
  type Scroll = { offset: { x: number; y: number } } | undefined;
  const node = root as unknown as { scroll: Scroll; updateScroll: (phase?: string) => void };
  const original = node.updateScroll.bind(node);
  node.updateScroll = (phase = "measure") => {
    if (phase === "measure") sync();
    const before = node.scroll;
    original(phase);
    if (node.scroll && node.scroll !== before) {
      node.scroll.offset = { x: node.scroll.offset.x, y: node.scroll.offset.y + compensation };
    }
  };
  patchedRoot = true;
};

export const scrollKeeper = {
  /** Start watching the stream. Returns a cleanup. */
  install(content: HTMLElement, getTopInset: () => number): () => void {
    topInset = getTopInset;
    ourScrollY = window.scrollY;

    const onScroll = () => {
      // Our own scrolls come back as events too; only the user's re-pick.
      if (Math.abs(window.scrollY - ourScrollY) < 1) return;
      ourScrollY = window.scrollY;
      reveal = null;
      repick();
    };
    // Grabbing the wheel mid-reveal hands control straight back.
    const cancelReveal = () => (reveal = null);

    const changed = () => {
      patchFramer();
      sync();
      startLoop();
    };
    const resize = new ResizeObserver(changed);
    resize.observe(content);
    const mutations = new MutationObserver(changed);
    mutations.observe(content, { childList: true, subtree: true });

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", cancelReveal, { passive: true });
    window.addEventListener("touchstart", cancelReveal, { passive: true });
    return () => {
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", cancelReveal);
      window.removeEventListener("touchstart", cancelReveal);
      cancelAnimationFrame(raf);
      raf = 0;
    };
  },

  /**
   * Hold this row and ease it into view (opening a card, moving the cursor).
   * Call it *before* the state change that opens it: the row is held where it
   * is now, so a card collapsing above it in the same commit can't knock it
   * away before the reveal starts.
   */
  reveal(key: string): void {
    const el = find(key);
    if (!el) return;
    patchFramer();
    setAnchor(el, true);
    const now = performance.now();
    reveal = { until: now + REVEAL_MS, last: now };
    startLoop();
  },

  /**
   * Hold this row where its top is now, but no higher than the header — so
   * closing a card you'd scrolled deep into leaves its row in view. Like
   * `reveal`, call it before the state change.
   */
  hold(key: string): void {
    const el = find(key);
    if (!el) return;
    patchFramer();
    reveal = null;
    setAnchor(el, true, Math.max(viewportTop(el), visibleTop()));
  },

  /** Forget the anchor (switching views). */
  release(): void {
    anchor = null;
    reveal = null;
  },
};

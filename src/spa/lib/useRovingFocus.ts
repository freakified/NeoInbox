import { type RefObject, useEffect } from "react";

/**
 * One tab stop for a long list of buttons, like the drawer's views: Tab
 * enters on the current one (`aria-current`) and leaves on the next, and the
 * arrow keys, Home and End move between them. Mark the container with
 * `data-arrow-keys` so the list-wide j/k arrows leave it alone.
 */
export const useRovingFocus = (containerRef: RefObject<HTMLElement | null>) => {
  const items = () =>
    Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);

  // Every render: buttons come and go (custom bundles, Trips on or off), and
  // the current view moves. Entering always lands on the current one.
  useEffect(() => {
    const all = items();
    const stop = all.find((el) => el.hasAttribute("aria-current")) ?? all[0];
    for (const el of all) el.tabIndex = el === stop ? 0 : -1;
  });

  return (e: React.KeyboardEvent<HTMLElement>) => {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    const next =
      e.key === "ArrowDown" ? Math.min(index + 1, all.length - 1)
      : e.key === "ArrowUp" ? Math.max(index - 1, 0)
      : e.key === "Home" ? 0
      : e.key === "End" ? all.length - 1
      : null;
    if (next === null) return;
    e.preventDefault();
    for (const el of all) el.tabIndex = -1;
    all[next]!.tabIndex = 0;
    all[next]!.focus();
  };
};

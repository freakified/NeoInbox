/**
 * Focus across a row opening or closing.
 *
 * A row draws a different control open than closed (a bundle's summary row vs
 * its title bar, a thread's row vs its subject), so the control that had focus
 * is gone after the toggle and focus would fall back to <body>: a screen
 * reader loses its place, and the next `j` restarts at the top of the list.
 * Each row marks its current toggle with `data-row-toggle="<row key>"`, and
 * focus follows the row to it.
 */

import { ROW_KEY_ATTR, findByAttr } from "./scrollKeeper";

export const ROW_TOGGLE_ATTR = "data-row-toggle";

/**
 * Call before the open state changes. Focus moves only if it was in the row:
 * a row closing because another opened leaves focus with that one, and a
 * click on a row's text (which focuses nothing) doesn't draw a focus ring.
 */
export const focusToggleAfterChange = (rowKey: string): void => {
  const active = document.activeElement;
  if (!active || !findByAttr(ROW_KEY_ATTR, rowKey)?.contains(active)) return;

  requestAnimationFrame(() => {
    // The scroll keeper has already put the row where it belongs.
    findByAttr(ROW_TOGGLE_ATTR, rowKey)?.focus({ preventScroll: true });
  });
};

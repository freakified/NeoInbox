/**
 * Keyboard cursor for the message list.
 *
 * The stream is rendered as several sections, each of which may split around an
 * expanded row, so there is no single array to index into. Rather than thread a
 * cursor through every row component, navigation walks the rendered
 * `[data-row-header]` elements — document order is visual order, and it stays
 * correct through expand/collapse without extra bookkeeping.
 */

import { rowKeyOf, scrollKeeper } from "./scrollKeeper";

const ROW_SELECTOR = "[data-row-header]";

export const rowHeaders = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(ROW_SELECTOR));

/** The row header `el` belongs to: its own, or its row's when it's a control beside it. */
export const rowHeaderOf = (el: Element | null): HTMLElement | null =>
  el?.closest<HTMLElement>(ROW_SELECTOR) ??
  el?.closest("[data-row]")?.querySelector<HTMLElement>(ROW_SELECTOR) ??
  null;

export const focusedRow = (): HTMLElement | null => rowHeaderOf(document.activeElement);

const focusRow = (row: HTMLElement | undefined, reveal = true): boolean => {
  if (!row) return false;
  // The scroll keeper does the scrolling: native focus scrolling ignores the
  // fixed header and would fight the keeper's anchor.
  const key = rowKeyOf(row);
  if (reveal && key) scrollKeeper.reveal(key);
  row.focus({ preventScroll: true });
  return true;
};

/** Move the cursor by `delta` rows; entering from nowhere lands on the first row. */
export const moveRowFocus = (delta: number): boolean => {
  const rows = rowHeaders();
  if (!rows.length) return false;

  const current = focusedRow();
  if (!current) return focusRow(delta > 0 ? rows[0] : rows[rows.length - 1]);

  const index = rows.indexOf(current);
  if (index === -1) return focusRow(rows[0]);

  const next = Math.min(Math.max(index + delta, 0), rows.length - 1);
  return focusRow(rows[next]);
};

/**
 * Keep the cursor usable across an action that removes the row (done, trash,
 * snooze). Focus would otherwise fall back to <body> and the next `j` would
 * restart at the top of the list.
 */
export const keepFocusAfterRowRemoval = (): void => {
  const index = rowHeaders().indexOf(focusedRow() as HTMLElement);
  if (index !== -1) requestAnimationFrame(() => focusRowAt(index));
};

/**
 * Focus whichever row is now at `index` (or the last), as after the row that
 * was there is removed.
 */
export const focusRowAt = (index: number): void => {
  const rows = rowHeaders();
  if (!rows.length) return;
  // Already in place: the scroll keeper puts the next row where this one was.
  focusRow(rows[Math.min(index, rows.length - 1)], false);
};

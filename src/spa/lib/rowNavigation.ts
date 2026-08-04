/**
 * Keyboard cursor for the message list.
 *
 * The stream is rendered as several sections, each of which may split around an
 * expanded row, so there is no single array to index into. Rather than thread a
 * cursor through every row component, navigation walks the rendered
 * `[data-row-header]` elements — document order is visual order, and it stays
 * correct through expand/collapse without extra bookkeeping.
 */

const ROW_SELECTOR = "[data-row-header]";

export const rowHeaders = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(ROW_SELECTOR));

export const focusedRow = (): HTMLElement | null => {
  const active = document.activeElement;
  return active instanceof HTMLElement ? active.closest<HTMLElement>(ROW_SELECTOR) : null;
};

const focusRow = (row: HTMLElement | undefined): boolean => {
  if (!row) return false;
  row.focus();
  row.scrollIntoView({ block: "nearest" });
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
  const rows = rowHeaders();
  const index = rows.indexOf(focusedRow() as HTMLElement);
  if (index === -1) return;

  requestAnimationFrame(() => {
    const next = rowHeaders();
    if (!next.length) return;
    focusRow(next[Math.min(index, next.length - 1)]);
  });
};

/**
 * While a dialog or popup menu is up it owns the keyboard — list shortcuts must
 * not fire behind it, and Escape belongs to the overlay rather than to the
 * expanded conversation underneath.
 *
 * Every overlay in the app carries one of these roles, which makes this a
 * cheaper and less fragile probe than threading each overlay's open state
 * through to every keyboard handler.
 *
 * Overlays that stay mounted while closed (the FAB's speed-dial menu) mark
 * themselves aria-hidden, and must not count: matching them left every
 * shortcut in the app permanently disabled.
 */
export const overlayIsOpen = (): boolean =>
  document.querySelector(
    '[role="dialog"]:not([aria-hidden="true"]), [role="menu"]:not([aria-hidden="true"])',
  ) !== null;

/**
 * While a dialog or popup menu is up it owns the keyboard — list shortcuts must
 * not fire behind it, and Escape belongs to the overlay rather than to the
 * expanded conversation underneath.
 *
 * Every overlay in the app carries one of these roles, which makes this a
 * cheaper and less fragile probe than threading each overlay's open state
 * through to every keyboard handler.
 */
export const overlayIsOpen = (): boolean =>
  document.querySelector('[role="dialog"], [role="menu"]') !== null;

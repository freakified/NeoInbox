import { type RefObject, useEffect, useRef } from "react";
import { focusRowAt, rowHeaderOf, rowHeaders } from "./rowNavigation";

/**
 * Keyboard behaviour for a portaled menu.
 *
 * Menus are portaled to <body> so rows can't paint over them, which also puts
 * them outside the tab order next to their trigger. So focus is carried in and
 * out: opening focuses the first item, arrows move between items, Escape and
 * Tab close the menu and return to the trigger. Focus leaving for anything
 * else closes it too, and opening one menu closes any other.
 *
 * When `dialog` is set (a menu that has turned into a form, like snooze's
 * date picker) Tab stays inside instead of closing.
 */

const ITEM_SELECTOR =
  '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)';
const FOCUSABLE_SELECTOR =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

// The one menu open right now; opening another closes it first.
let closeOpenMenu: (() => void) | null = null;

export const useMenuFocus = ({
  open,
  onClose,
  triggerRef,
  menuRef,
  dialog = false,
  layoutKey,
}: {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  menuRef: RefObject<HTMLElement | null>;
  dialog?: boolean;
  /** Refocuses the first item when the menu swaps content (a submenu view). */
  layoutKey?: unknown;
}) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // One open at a time, however the second was opened.
  useEffect(() => {
    if (!open) return;
    const close = () => onCloseRef.current();
    closeOpenMenu?.();
    closeOpenMenu = close;
    return () => {
      if (closeOpenMenu === close) closeOpenMenu = null;
    };
  }, [open]);

  // Where focus goes back to on close. The trigger can be gone by then, as
  // when snoozing removes the row it was on; the row now in its place stands in.
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const rowIndex = rowHeaders().indexOf(rowHeaderOf(trigger) as HTMLElement);
    return () => {
      requestAnimationFrame(() => {
        // Something else took focus (a dialog the menu opened, a click elsewhere).
        const active = document.activeElement;
        if (active && active !== document.body) return;
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
        else if (rowIndex !== -1) focusRowAt(rowIndex);
      });
    };
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    // A choice menu starts on what's chosen.
    const first =
      menu?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      menu?.querySelector<HTMLElement>(ITEM_SELECTOR) ??
      menu?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    first?.focus({ preventScroll: true });
  }, [open, menuRef, layoutKey]);

  const returnToTrigger = () => {
    onCloseRef.current();
    triggerRef.current?.focus({ preventScroll: true });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const menu = menuRef.current;
    if (!menu) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      returnToTrigger();
      return;
    }

    if (e.key === "Tab") {
      if (!dialog) {
        e.preventDefault();
        returnToTrigger();
        return;
      }
      const focusable = Array.from(menu.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
      return;
    }

    const items = Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "ArrowDown" ? (index + 1) % items.length
      : e.key === "ArrowUp" ? (index - 1 + items.length) % items.length
      : e.key === "Home" ? 0
      : e.key === "End" ? items.length - 1
      : null;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    items[next]?.focus();
  };

  // Tabbing or clicking to something outside closes the menu. A click on the
  // menu's own non-focusable parts blurs to nothing, which doesn't count.
  const onBlur = (e: React.FocusEvent<HTMLElement>) => {
    const to = e.relatedTarget as Node | null;
    if (!to || menuRef.current?.contains(to) || triggerRef.current?.contains(to)) return;
    onCloseRef.current();
  };

  return { onKeyDown, onBlur };
};

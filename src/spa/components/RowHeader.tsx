import { clsx } from "clsx";
import { useId, useState } from "react";
import s from "./RowHeader.module.css";

export const RowHeader = ({
  leading,
  primary,
  secondary,
  subline,
  trailing,
  date,
  status,
  label,
  bold = false,
  onClick,
  onKeyDown,
  expanded,
  toggleKey,
  selected = false,
  actionStrip,
}: {
  leading: React.ReactNode;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  /** A second line under the subject, such as a woken snooze. */
  subline?: React.ReactNode;
  trailing?: React.ReactNode;
  date?: React.ReactNode;
  /** Spoken after the row's text: what `date` and `bold` only show (unread, pinned). */
  status?: string;
  /** Spoken in place of the row's text, when that reads badly aloud. */
  label?: string;
  bold?: boolean;
  /** Called with the mouse event on a click, with nothing from Enter/Space. */
  onClick?: (e?: React.MouseEvent<HTMLDivElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  expanded?: boolean;
  /** The row's key, when opening it swaps this header for another control. */
  toggleKey?: string;
  selected?: boolean;
  actionStrip?: React.ReactNode;
}) => {
  const [hovered, setHovered] = useState(false);
  const id = useId();
  const labelIds = [
    `${id}-primary`,
    secondary && `${id}-secondary`,
    subline && `${id}-subline`,
    status && `${id}-status`,
  ].filter(Boolean).join(" ");
  const named = onClick ? true : undefined;

  // The row's own control is a button laid over the whole row, so the
  // controls drawn on it (avatar, cards, action strip) stay its siblings: a
  // button's contents are flattened into its name, out of a screen reader's
  // reach. The text it's named by is hidden so it isn't read twice.
  //
  // `data-row-header` is what the global j/k handler walks: it marks every
  // openable row (thread, bundle, trip) in document order, which is the same
  // order the user sees.
  return (
    <div
      className={clsx(s.row, selected && s.selected)}
      onClick={
        // A click from Enter/Space on the button has no pointer position.
        onClick ? (e) => onClick(e.detail === 0 ? undefined : e) : undefined
      }
      // Shift-click extends a selection; without this it also drags a text
      // selection across every row in between.
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      onKeyDown={(e) => {
        // Dialogs opened from the action strip are portaled out of the row,
        // but React still bubbles their keystrokes here; leave those alone.
        if (!e.currentTarget.contains(e.target as Node)) return;
        onKeyDown?.(e);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {onClick && (
        <button
          type="button"
          className={s.toggle}
          data-row-header=""
          data-row-toggle={toggleKey}
          aria-expanded={expanded}
          aria-label={label}
          aria-labelledby={label ? undefined : labelIds}
        />
      )}
      <div className={s.leading}>{leading}</div>
      <span id={`${id}-primary`} aria-hidden={named} className={clsx(s.primary, bold && s.bold)}>
        {primary}
      </span>
      <div className={s.body}>
        <span id={`${id}-secondary`} aria-hidden={named} className={clsx(s.secondary, bold && s.bold)}>
          {secondary}
        </span>
        {subline && (
          <div id={`${id}-subline`} aria-hidden={named} className={s.subline}>
            {subline}
          </div>
        )}
        {trailing && <div className={s.trailing}>{trailing}</div>}
      </div>
      {date && <span className={s.date} aria-hidden={named}>{date}</span>}
      {status && <span id={`${id}-status`} hidden>{status}</span>}
      {actionStrip && (
        <div className={clsx(s.actionSlot, hovered && s.actionSlotVisible)}>
          {actionStrip}
        </div>
      )}
    </div>
  );
};

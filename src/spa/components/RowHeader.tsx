import { clsx } from "clsx";
import { useState } from "react";
import s from "./RowHeader.module.css";

export const RowHeader = ({
  leading,
  primary,
  secondary,
  subline,
  trailing,
  date,
  bold = false,
  onClick,
  onKeyDown,
  expanded,
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
  bold?: boolean;
  /** Called with the mouse event on a click, with nothing from Enter/Space. */
  onClick?: (e?: React.MouseEvent<HTMLDivElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  expanded?: boolean;
  selected?: boolean;
  actionStrip?: React.ReactNode;
}) => {
  const [hovered, setHovered] = useState(false);

  // `data-row-header` is what the global j/k handler walks: it marks every
  // openable row (thread, bundle, trip) in document order, which is the same
  // order the user sees.
  return (
    <div
      className={clsx(s.row, selected && s.selected)}
      data-row-header={onClick ? "" : undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-expanded={expanded}
      onClick={onClick ? (e) => onClick(e) : undefined}
      // Shift-click extends a selection; without this it also drags a text
      // selection across every row in between.
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      onKeyDown={(e) => {
        // Dialogs opened from the action strip are portaled out of the row,
        // but React still bubbles their keystrokes here; leave those alone.
        if (!e.currentTarget.contains(e.target as Node)) return;
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
          return;
        }
        onKeyDown?.(e);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={s.leading}>{leading}</div>
      <span className={clsx(s.primary, bold && s.bold)}>{primary}</span>
      <div className={s.body}>
        <span className={clsx(s.secondary, bold && s.bold)}>{secondary}</span>
        {subline && <div className={s.subline}>{subline}</div>}
        {trailing && <div className={s.trailing}>{trailing}</div>}
      </div>
      {date && <span className={s.date}>{date}</span>}
      {actionStrip && (
        <div className={clsx(s.actionSlot, hovered && s.actionSlotVisible)}>
          {actionStrip}
        </div>
      )}
    </div>
  );
};

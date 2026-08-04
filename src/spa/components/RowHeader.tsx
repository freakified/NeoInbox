import { clsx } from "clsx";
import { useState } from "react";
import s from "./RowHeader.module.css";

export const RowHeader = ({
  leading,
  primary,
  secondary,
  trailing,
  date,
  bold = false,
  onClick,
  onKeyDown,
  expanded,
  actionStrip,
}: {
  leading: React.ReactNode;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  trailing?: React.ReactNode;
  date?: React.ReactNode;
  bold?: boolean;
  onClick?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  expanded?: boolean;
  actionStrip?: React.ReactNode;
}) => {
  const [hovered, setHovered] = useState(false);

  // `data-row-header` is what the global j/k handler walks: it marks every
  // openable row (thread, bundle, trip) in document order, which is the same
  // order the user sees.
  return (
    <div
      className={s.row}
      data-row-header={onClick ? "" : undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-expanded={expanded}
      onClick={onClick}
      onKeyDown={(e) => {
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

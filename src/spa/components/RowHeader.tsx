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
  actionStrip,
}: {
  leading: React.ReactNode;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  trailing?: React.ReactNode;
  date?: string;
  bold?: boolean;
  onClick?: () => void;
  actionStrip?: React.ReactNode;
}) => {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={s.row}
      onClick={onClick}
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

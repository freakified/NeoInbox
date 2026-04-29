import { clsx } from "clsx";
import { useState } from "react";
import s from "./RowHeader.module.css";

export const RowHeader = ({
  leading,
  primary,
  secondary,
  date,
  bold = false,
  onClick,
  actionStrip,
}: {
  leading: React.ReactNode;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
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
      <span className={clsx(s.secondary, bold && s.bold)}>{secondary}</span>
      {date && <span className={s.date}>{date}</span>}
      {hovered && actionStrip}
    </div>
  );
};

import { useState } from "react";

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
      className="relative py-2 px-3 flex gap-3 items-center text-sm cursor-pointer hover:bg-neutral-50"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="shrink-0">{leading}</div>
      <span
        className={`w-44 truncate shrink-0 text-md-on-surface ${bold ? "font-semibold" : "font-normal"}`}
      >
        {primary}
      </span>
      <span
        className={`truncate flex-1 ${bold ? "font-semibold text-md-on-surface" : "text-md-secondary-text"}`}
      >
        {secondary}
      </span>
      {date && (
        <span className="text-xs text-md-secondary-text shrink-0 ml-2">
          {date}
        </span>
      )}
      {hovered && actionStrip}
    </div>
  );
};

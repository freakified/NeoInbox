import { clsx } from "clsx";
import s from "./Icon.module.css";

export const Icon = ({
  name,
  className = "",
  style,
}: {
  name: string;
  className?: string;
  style?: React.CSSProperties;
}) => (
  <span className={clsx("material-symbols-rounded", s.icon, className)} style={style} aria-hidden="true">
    {name}
  </span>
);

import { clsx } from "clsx";
import { MotionSurface } from "./Motion";
import s from "./RowGroup.module.css";

export const RowGroup = ({
  children,
  layoutId,
  className,
}: {
  children: React.ReactNode;
  layoutId?: string;
  className?: string;
}) => (
  <MotionSurface layoutId={layoutId} className={clsx(s.group, className)}>
    {children}
  </MotionSurface>
);

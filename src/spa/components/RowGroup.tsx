import { MotionSurface } from "./Motion";
import s from "./RowGroup.module.css";

export const RowGroup = ({ children, layoutId }: { children: React.ReactNode; layoutId?: string }) => (
  <MotionSurface layoutId={layoutId} className={s.group}>
    {children}
  </MotionSurface>
);

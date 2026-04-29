import { motion } from "framer-motion";
import s from "./RowGroup.module.css";

export const RowGroup = ({ children, layoutId }: { children: React.ReactNode; layoutId?: string }) => (
  <motion.div
    layout
    layoutId={layoutId}
    transition={{ type: "spring", stiffness: 500, damping: 40 }}
    className={s.group}
  >
    {children}
  </motion.div>
);

import { motion } from "framer-motion";
import s from "./RowGroup.module.css";

export const RowGroup = ({ children }: { children: React.ReactNode }) => (
  <motion.div
    layout
    transition={{ type: "spring", stiffness: 500, damping: 40 }}
    className={s.group}
  >
    {children}
  </motion.div>
);

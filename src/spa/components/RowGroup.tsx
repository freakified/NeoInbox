import { motion } from "framer-motion";

export const RowGroup = ({ children }: { children: React.ReactNode }) => (
  <motion.div
    layout
    transition={{ type: "spring", stiffness: 500, damping: 40 }}
    className="max-w-3xl mx-auto w-full bg-white shadow-sm overflow-hidden divide-y divide-md-divider"
  >
    {children}
  </motion.div>
);

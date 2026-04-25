import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Thread } from "../../shared/types";
import { formatDate } from "../lib/dateBucket";
import { ActionStrip } from "./ActionStrip";
import { ThreadView } from "./ThreadView";

export const ThreadRow = ({
  thread: t,
  isExpanded,
  onToggleExpand,
  expandedRef,
}: {
  thread: Thread;
  isExpanded: boolean;
  onToggleExpand: () => void;
  expandedRef: React.RefObject<HTMLDivElement | null>;
}) => {
  const [hovered, setHovered] = useState(false);
  const weight = t.unreadCount > 0 ? " font-semibold" : "";

  return (
    <motion.div
      layout
      data-row
      ref={isExpanded ? expandedRef : undefined}
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      className={
        isExpanded
          ? "w-full my-4 bg-white rounded-xl shadow-lg overflow-hidden"
          : "w-full max-w-3xl mx-auto bg-white border-b border-neutral-100 last:border-b-0"
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!isExpanded && (
        <div
          className="relative py-2 px-3 flex gap-3 items-baseline text-sm cursor-pointer hover:bg-neutral-50"
          onClick={onToggleExpand}
        >
          <span className="text-xs text-neutral-400 w-20 shrink-0">
            {formatDate(t.latestDate)}
          </span>
          <span className={"w-48 truncate shrink-0" + weight}>
            {t.participantsLabel}
          </span>
          <span className={"truncate" + weight}>
            {t.subject || "(no subject)"}
          </span>
          {hovered && <ActionStrip thread={t} />}
        </div>
      )}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeInOut" }}
          >
            <ThreadView thread={t} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

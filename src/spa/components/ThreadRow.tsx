import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Thread } from "../../shared/types";
import { avatarColor, senderInitial, senderName } from "../lib/avatar";
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
  const bold = t.unreadCount > 0;

  const firstSender = t.messages[0];
  const name = firstSender ? senderName(firstSender.author) : "";
  const avatarBg = avatarColor(name);
  const initial = firstSender ? senderInitial(firstSender.author) : "?";

  return (
    <motion.div
      layout
      data-row
      ref={isExpanded ? expandedRef : undefined}
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      className={
        isExpanded
          ? "w-full my-4 bg-white rounded-xl shadow-elevation-3 overflow-hidden"
          : "w-full max-w-3xl mx-auto bg-white border-b border-md-divider last:border-b-0"
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!isExpanded && (
        <div
          className="relative py-2 px-3 flex gap-3 items-center text-sm cursor-pointer hover:bg-neutral-50"
          onClick={onToggleExpand}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white font-medium text-sm shrink-0"
            style={{ backgroundColor: avatarBg }}
          >
            {initial}
          </div>
          <span className={`w-44 truncate shrink-0 ${bold ? "font-semibold text-md-on-surface" : "text-md-on-surface"}`}>
            {t.participantsLabel}
          </span>
          <span className={`truncate flex-1 ${bold ? "font-semibold text-md-on-surface" : "text-md-secondary-text"}`}>
            {t.subject || "(no subject)"}
          </span>
          <span className="text-xs text-md-secondary-text shrink-0 ml-2">
            {formatDate(t.latestDate)}
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

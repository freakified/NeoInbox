import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Thread } from "../../shared/types";
import { avatarColor, senderInitial, senderName } from "../lib/avatar";
import { formatDate } from "../lib/dateBucket";
import { ActionStrip } from "./ActionStrip";
import { ThreadView } from "./ThreadView";

export const BundleThreadCard = ({
  thread: t,
  accentColor,
  isOpen,
  onToggle,
}: {
  thread: Thread;
  accentColor: string;
  isOpen: boolean;
  onToggle: () => void;
}) => {
  const [hovered, setHovered] = useState(false);
  const latest = t.messages[t.messages.length - 1];
  if (!latest) return null;
  const color = avatarColor(senderName(latest.author));
  const weight =
    t.unreadCount > 0 ? "font-semibold text-neutral-900" : "text-neutral-500";

  return (
    <div
      className="bg-white rounded-lg shadow-sm overflow-hidden"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="relative flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-neutral-50"
        onClick={onToggle}
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0"
          style={{ backgroundColor: color }}
        >
          {senderInitial(latest.author)}
        </div>
        <div className="min-w-0 flex-1 flex items-baseline gap-2">
          <span className={`text-sm shrink-0 ${weight}`}>
            {t.participantsLabel}
          </span>
          <span className="text-sm text-neutral-400 truncate">
            — {t.subject || "(no subject)"}
          </span>
          <span className="text-xs text-neutral-400 shrink-0 ml-auto">
            {formatDate(t.latestDate)}
          </span>
        </div>
        {hovered && !isOpen && <ActionStrip thread={t} />}
      </div>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeInOut" }}
            className="overflow-hidden border-t border-neutral-100"
          >
            <ThreadView thread={t} accentColor={accentColor} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

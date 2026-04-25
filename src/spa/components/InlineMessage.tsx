import { AnimatePresence, motion } from "framer-motion";
import type { RawMessage } from "../../shared/types";
import { avatarColor, senderInitial, senderName } from "../lib/avatar";
import { formatDate } from "../lib/dateBucket";
import { MessageBody } from "./MessageBody";

export const InlineMessage = ({
  message: m,
  accentColor,
  isOpen,
  onToggle,
}: {
  message: RawMessage;
  accentColor?: string;
  isOpen: boolean;
  onToggle: () => void;
}) => {
  const name = senderName(m.author);
  const color = avatarColor(name);
  const weight = m.read
    ? "text-neutral-600"
    : "font-semibold text-neutral-900";

  return (
    <div className="bg-white">
      <div
        className="flex items-center gap-4 px-5 py-3 cursor-pointer hover:bg-neutral-50"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0"
          style={{ backgroundColor: color }}
        >
          {senderInitial(m.author)}
        </div>
        <div className="min-w-0 flex-1 flex items-baseline gap-2">
          <span className={`text-sm shrink-0 ${weight}`}>
            {m.origin === "sent" ? `${name} → ` : name}
          </span>
          <span className="text-xs text-neutral-400 shrink-0 ml-auto">
            {formatDate(m.date)}
          </span>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <MessageBody message={m} accentColor={accentColor} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

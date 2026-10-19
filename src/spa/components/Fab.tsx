import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMailStore, type NewMessagePrefill } from "../../store/mailStore";
import { avatarColor, senderInitial, senderName } from "../lib/avatar";
import { ContactPhoto } from "./ContactPhoto";
import { Icon } from "./Icon";
import { ReminderComposer } from "./ReminderComposer";
import { ComposeDock, ComposePanel } from "./ComposePanel";
import s from "./Fab.module.css";

interface FabContact {
  email: string;
  name: string;
  /** Original "Name <email>" form, handed to the composer as-is. */
  raw: string;
}

const addressEmail = (raw: string): string => {
  const m = raw.match(/<([^>]+)>/);
  return (m?.[1] ?? raw).trim().toLowerCase();
};

/** The people you email most, measured over locally cached sent mail. */
const useTopContacts = (limit: number): FabContact[] => {
  const messagesByKey = useMailStore((st) => st.messagesByKey);
  const myEmails = useMailStore((st) => st.myEmails);
  return useMemo(() => {
    const counts = new Map<string, { contact: FabContact; count: number }>();
    for (const m of Object.values(messagesByKey)) {
      if (m.origin !== "sent") continue;
      for (const raw of m.recipients) {
        const email = addressEmail(raw);
        if (!email || !email.includes("@") || myEmails.has(email)) continue;
        const entry = counts.get(email);
        if (entry) entry.count += 1;
        else counts.set(email, { contact: { email, name: senderName(raw), raw }, count: 1 });
      }
    }
    return [...counts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map((entry) => entry.contact);
  }, [messagesByKey, myEmails, limit]);
};

const itemVariants = {
  hidden: { opacity: 0, scale: 0.3, y: 14 },
  show: (delay: number) => ({
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { delay, type: "spring" as const, stiffness: 620, damping: 30 },
  }),
  exit: (delay: number) => ({
    opacity: 0,
    scale: 0.3,
    y: 14,
    transition: { delay, duration: 0.1 },
  }),
};

export const Fab = () => {
  const [open, setOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  /** The inline new-message panel; `to` set when opened from a contact. */
  const [newMessage, setNewMessage] = useState<{
    to?: string[];
    prefill?: NewMessagePrefill;
    key: number;
  } | null>(null);
  const startMessage = (to?: string[]) => setNewMessage({ to, key: Date.now() });
  // Elsewhere in the app (a trip's Forward) can ask for a prefilled message.
  const newMessageRequest = useMailStore((st) => st.newMessageRequest);
  const clearNewMessageRequest = useMailStore((st) => st.clearNewMessageRequest);
  useEffect(() => {
    if (!newMessageRequest) return;
    const { key, ...prefill } = newMessageRequest;
    clearNewMessageRequest();
    setNewMessage({ prefill, key });
  }, [newMessageRequest, clearNewMessageRequest]);
  const poppedReply = useMailStore((st) => st.poppedReply);
  const clearPoppedReply = useMailStore((st) => st.clearPoppedReply);
  const reducedMotion = useReducedMotion();
  const contacts = useTopContacts(3);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Like the original Inbox, the menu opens on hover (or keyboard focus) and
  // the main button itself composes. A short close delay lets the pointer
  // cross the gaps between mini-buttons without the menu collapsing.
  const closeTimer = useRef<number | undefined>(undefined);
  const cancelClose = () => window.clearTimeout(closeTimer.current);
  const openMenu = () => {
    cancelClose();
    setOpen(true);
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 180);
  };
  useEffect(() => cancelClose, []);

  const runAction = (action: () => void) => {
    cancelClose();
    setOpen(false);
    (document.activeElement as HTMLElement | null)?.blur();
    action();
  };

  // Top to bottom: frequent contacts, then reminder nearest the FAB —
  // mirroring the original Inbox speed dial. Compose is the FAB itself.
  const items = [
    ...contacts.map((contact) => ({
      key: `contact:${contact.email}`,
      label: contact.name,
      button: (
        <span
          className={s.miniCircle}
          style={{ backgroundColor: avatarColor(contact.name), color: "#fff" }}
        >
          <ContactPhoto address={contact.raw}>{senderInitial(contact.raw)}</ContactPhoto>
        </span>
      ),
      onClick: () => runAction(() => startMessage([contact.raw])),
    })),
    {
      key: "reminder",
      label: "Reminder",
      button: (
        <span className={s.miniCircle} style={{ backgroundColor: "#4285F4", color: "#fff" }}>
          <Icon name="pan_tool_alt" className={s.miniIcon} />
        </span>
      ),
      onClick: () => runAction(() => setComposerOpen(true)),
    },
  ];

  const renderItem = (item: (typeof items)[number]) => (
    <button
      type="button"
      className={s.item}
      onClick={item.onClick}
      title={item.label}
    >
      <span className={s.itemLabel}>{item.label}</span>
      {item.button}
    </button>
  );

  return (
    <>
      <div
        className={s.wrap}
        onMouseEnter={openMenu}
        onMouseLeave={closeSoon}
        onFocus={openMenu}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) closeSoon();
        }}
      >
        <div className={s.stack} role="menu" aria-hidden={!open}>
          {reducedMotion ? (
            open && items.map((item) => <div key={item.key}>{renderItem(item)}</div>)
          ) : (
            <AnimatePresence>
              {open &&
                items.map((item, idx) => (
                  <motion.div
                    key={item.key}
                    variants={itemVariants}
                    initial="hidden"
                    animate="show"
                    exit="exit"
                    // Expand from the FAB upward; collapse top-down back into it.
                    custom={(items.length - 1 - idx) * 0.035}
                  >
                    {renderItem(item)}
                  </motion.div>
                ))}
            </AnimatePresence>
          )}
        </div>
        <motion.button
          type="button"
          className={`${s.fab} ${open ? s.fabOpen : ""}`}
          aria-label="Compose"
          aria-haspopup="menu"
          aria-expanded={open}
          title="Compose"
          whileTap={reducedMotion ? undefined : { scale: 0.92 }}
          onClick={() => runAction(() => startMessage())}
        >
          <Icon name="add" className={`${s.fabIcon} ${s.fabIconPlus}`} />
          <Icon name="edit" className={`${s.fabIcon} ${s.fabIconPencil}`} />
        </motion.button>
      </div>
      {composerOpen && <ReminderComposer onClose={() => setComposerOpen(false)} />}
      <ComposeDock>
        {newMessage && (
          <ComposePanel
            key={newMessage.key}
            to={newMessage.to}
            prefill={newMessage.prefill}
            onClose={() => setNewMessage(null)}
            onReopen={() => setNewMessage({ key: Date.now() })}
          />
        )}
        {poppedReply && (
          <ComposePanel
            key={poppedReply.key}
            reply={poppedReply}
            onClose={clearPoppedReply}
          />
        )}
      </ComposeDock>
    </>
  );
};

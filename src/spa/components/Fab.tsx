import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useMailStore } from "../../store/mailStore";
import { avatarColor, senderInitial, senderName } from "../lib/avatar";
import { Icon } from "./Icon";
import { ReminderComposer } from "./ReminderComposer";
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
  const messagesById = useMailStore((st) => st.messagesById);
  const myEmails = useMailStore((st) => st.myEmails);
  return useMemo(() => {
    const counts = new Map<string, { contact: FabContact; count: number }>();
    for (const m of Object.values(messagesById)) {
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
  }, [messagesById, myEmails, limit]);
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

  const runAction = (action: () => void) => {
    setOpen(false);
    action();
  };

  // Top to bottom: reminder, frequent contacts, compose nearest the FAB —
  // mirroring the original Inbox speed dial.
  const items = [
    {
      key: "reminder",
      label: "Reminder",
      button: (
        <span className={s.miniCircle}>
          <Icon name="pan_tool_alt" className={s.miniIcon} style={{ color: "#4285F4" }} />
        </span>
      ),
      onClick: () => runAction(() => setComposerOpen(true)),
    },
    ...contacts.map((contact) => ({
      key: `contact:${contact.email}`,
      label: contact.name,
      button: (
        <span
          className={s.miniCircle}
          style={{ backgroundColor: avatarColor(contact.name), color: "#fff" }}
        >
          {senderInitial(contact.raw)}
        </span>
      ),
      onClick: () =>
        runAction(() => {
          void messenger.compose.beginNew({ to: [contact.raw] });
        }),
    })),
    {
      key: "compose",
      label: "Compose",
      button: (
        <span className={s.miniCircle}>
          <Icon name="edit" className={s.miniIcon} style={{ color: "#DB4437" }} />
        </span>
      ),
      onClick: () =>
        runAction(() => {
          void messenger.compose.beginNew();
        }),
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
      {open && (
        <button
          type="button"
          className={s.scrim}
          aria-label="Close create menu"
          onClick={() => setOpen(false)}
        />
      )}
      <div className={s.wrap}>
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
          aria-label={open ? "Close create menu" : "Create"}
          aria-expanded={open}
          whileTap={reducedMotion ? undefined : { scale: 0.92 }}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="edit" className={`${s.fabIcon} ${s.fabIconPencil}`} />
          <Icon name="close" className={`${s.fabIcon} ${s.fabIconClose}`} />
        </motion.button>
      </div>
      {composerOpen && <ReminderComposer onClose={() => setComposerOpen(false)} />}
    </>
  );
};

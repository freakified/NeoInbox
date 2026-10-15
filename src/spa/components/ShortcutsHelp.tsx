import { useEffect } from "react";
import s from "./ShortcutsHelp.module.css";

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Navigate",
    items: [
      ["j / ↓", "Next conversation"],
      ["k / ↑", "Previous conversation"],
      ["Enter", "Open or close"],
      ["Esc", "Close the open conversation, or clear the selection"],
    ],
  },
  {
    title: "Act on a conversation",
    items: [
      ["e", "Done"],
      ["s", "Snooze until tomorrow"],
      ["p", "Pin or unpin"],
      ["x", "Select or deselect (shift-click selects a range)"],
      ["#", "Trash (when delete actions are on)"],
    ],
  },
  {
    title: "Jump to a view",
    items: [
      ["g then i", "Inbox"],
      ["g then s", "Snoozed"],
      ["g then d", "Done"],
      ["g then t", "Trips"],
      ["g then r", "Reminders"],
    ],
  },
];

export const ShortcutsHelp = ({ onClose }: { onClose: () => void }) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className={s.scrim} onClick={onClose}>
      <div
        className={s.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={s.title}>Keyboard shortcuts</h2>
        <div className={s.groups}>
          {GROUPS.map((group) => (
            <section key={group.title} className={s.group}>
              <h3 className={s.groupTitle}>{group.title}</h3>
              <dl className={s.list}>
                {group.items.map(([keys, label]) => (
                  <div key={keys} className={s.item}>
                    <dt className={s.keys}>{keys}</dt>
                    <dd className={s.label}>{label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <button type="button" className={s.close} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
};

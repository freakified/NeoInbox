import { useState } from "react";
import { createPortal } from "react-dom";
import type { Thread } from "../../shared/types";
import { tripKeysOfThread } from "../../shared/trips";
import { useMailStore } from "../../store/mailStore";
import m from "./MoveRuleDialog.module.css";
import s from "./NewTripDialog.module.css";

/** Names a new trip and files the thread into it in one step. */
export const NewTripDialog = ({ thread, onClose }: { thread: Thread; onClose: () => void }) => {
  const createTrip = useMailStore((st) => st.createTrip);
  const setTripMembership = useMailStore((st) => st.setTripMembership);
  const notify = useMailStore((st) => st.notify);
  const [name, setName] = useState("");

  const createAndMove = () => {
    const trip = createTrip(name);
    setTripMembership(tripKeysOfThread(thread), trip.id);
    notify(`Moved to ${trip.name}`);
    onClose();
  };

  return createPortal(
    <div
      className={m.overlay}
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className={m.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-trip-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="new-trip-title" className={m.title}>
          New trip
        </h2>
        <p className={m.subtitle}>{thread.subject || "(no subject)"}</p>
        <input
          type="text"
          autoFocus
          className={s.nameInput}
          placeholder="Trip name (e.g. Trip to Tokyo)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && createAndMove()}
        />
        <div className={m.actions}>
          <button type="button" className={m.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={m.confirmBtn}
            disabled={!name.trim()}
            onClick={createAndMove}
          >
            Create trip
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

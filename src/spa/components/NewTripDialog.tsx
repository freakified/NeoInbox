import { useState } from "react";
import { createPortal } from "react-dom";
import type { Thread } from "../../shared/types";
import { tripKeysOfThread } from "../../shared/trips";
import { useMailStore } from "../../store/mailStore";
import { Icon } from "./Icon";
import s from "./NewTripDialog.module.css";

/** Names a new trip and files the threads into it in one step. */
export const NewTripDialog = ({
  threads,
  onClose,
  onCreated,
}: {
  threads: Thread[];
  onClose: () => void;
  /** After the trip exists and the threads are in it; onClose follows. */
  onCreated?: () => void;
}) => {
  const createTrip = useMailStore((st) => st.createTrip);
  const setTripMembership = useMailStore((st) => st.setTripMembership);
  const notify = useMailStore((st) => st.notify);
  const [name, setName] = useState("");

  const createAndMove = () => {
    const trip = createTrip(name);
    setTripMembership(threads.flatMap(tripKeysOfThread), trip.id);
    notify(`Moved to ${trip.name}`);
    onClose();
    onCreated?.();
  };

  return createPortal(
    <div
      className={s.overlay}
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-trip-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className={s.closeBtn} onClick={onClose} aria-label="Close">
          <Icon name="close" className={s.closeIcon} />
        </button>
        <h2 id="new-trip-title" className={s.title}>
          New trip
        </h2>
        <p className={s.subtitle}>
          {threads.length === 1 ? threads[0]?.subject || "(no subject)" : `${threads.length} conversations`}
        </p>
        <label className={s.field}>
          <span className={s.label}>Trip name</span>
          <input
            type="text"
            autoFocus
            className={s.nameInput}
            placeholder="Trip to San Francisco"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && createAndMove()}
          />
        </label>
        <div className={s.actions}>
          <button type="button" className={s.actionBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={s.primaryBtn}
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

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Thread } from "../../shared/types";
import { tripKeysOfThread } from "../../shared/trips";
import { useMailStore, useTrips } from "../../store/mailStore";
import { Icon } from "./Icon";
import m from "./MoveRuleDialog.module.css";
import s from "./TripPickerDialog.module.css";

export interface TripPickerDialogProps {
  thread: Thread;
  currentTripId: string | null;
  onClose: () => void;
}

export const TripPickerDialog = ({ thread, currentTripId, onClose }: TripPickerDialogProps) => {
  const tripsById = useTrips();
  const createTrip = useMailStore((st) => st.createTrip);
  const setTripMembership = useMailStore((st) => st.setTripMembership);
  const notify = useMailStore((st) => st.notify);

  const [newName, setNewName] = useState("");

  const trips = useMemo(
    () => Object.values(tripsById).sort((a, b) => b.createdAt - a.createdAt),
    [tripsById],
  );

  const keys = tripKeysOfThread(thread);

  const moveTo = (tripId: string, tripName: string) => {
    setTripMembership(keys, tripId);
    notify(`Moved to ${tripName}`);
    onClose();
  };

  const createAndMove = () => {
    const trip = createTrip(newName);
    setTripMembership(keys, trip.id);
    notify(`Moved to ${trip.name}`);
    onClose();
  };

  const removeFromTrip = () => {
    setTripMembership(keys, null);
    notify("Removed from trip");
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
        aria-labelledby="trip-picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="trip-picker-title" className={m.title}>
          Move to trip
        </h2>
        <p className={m.subtitle}>{thread.subject || "(no subject)"}</p>

        <div className={m.options}>
          {trips.map((trip) => {
            const isCurrent = trip.id === currentTripId;
            return (
              <div key={trip.id} className={isCurrent ? m.optionActive : m.option}>
                <button
                  type="button"
                  className={m.optionRow}
                  disabled={isCurrent}
                  onClick={() => moveTo(trip.id, trip.name)}
                >
                  <Icon name="flight" className={s.tripIcon} />
                  <span className={m.optionLabel}>{trip.name}</span>
                  {isCurrent && <span className={m.optionCount}>Current trip</span>}
                </button>
              </div>
            );
          })}
          {trips.length === 0 && (
            <p className={s.noTrips}>No trips yet — create the first one below.</p>
          )}
        </div>

        <div className={s.newTripRow}>
          <input
            type="text"
            className={s.newTripInput}
            placeholder="New trip name (e.g. Trip to Tokyo)"
            value={newName}
            autoFocus={trips.length === 0}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && newName.trim() && createAndMove()}
          />
          <button
            type="button"
            className={m.confirmBtn}
            disabled={!newName.trim()}
            onClick={createAndMove}
          >
            Create
          </button>
        </div>

        <div className={m.actions}>
          {currentTripId && (
            <button type="button" className={s.removeBtn} onClick={removeFromTrip}>
              Remove from trip
            </button>
          )}
          <button type="button" className={m.cancelBtn} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

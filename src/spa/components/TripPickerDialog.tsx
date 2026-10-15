import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { formatTripRange, tripWhen } from "../../shared/trips";
import type { TripRecord } from "../../shared/types";
import { useTrips } from "../../store/mailStore";
import { Icon } from "./Icon";
import { TRIP_COLOR } from "./TripSliceRow";
import m from "./MoveRuleDialog.module.css";
import s from "./TripPickerDialog.module.css";

/**
 * Every trip, for when the right one isn't among Move to's suggestions:
 * searchable, upcoming first, then past trips by year, newest first.
 */
export const TripPickerDialog = ({
  subject,
  currentTripId,
  onPick,
  onClose,
}: {
  subject: string;
  currentTripId: string | null;
  onPick: (tripId: string) => void;
  onClose: () => void;
}) => {
  const tripsById = useTrips();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const now = Date.now();
    const needle = query.trim().toLowerCase();
    const matching = Object.values(tripsById).filter(
      (t) => !needle || t.name.toLowerCase().includes(needle),
    );
    const upcoming = matching
      .filter((t) => tripWhen(t).end >= now)
      .sort((a, b) => tripWhen(a).start - tripWhen(b).start);
    const byYear = new Map<number, TripRecord[]>();
    for (const t of matching) {
      if (upcoming.includes(t)) continue;
      const year = new Date(tripWhen(t).start).getFullYear();
      byYear.set(year, [...(byYear.get(year) ?? []), t]);
    }
    const past = [...byYear.entries()]
      .sort(([a], [b]) => b - a)
      .map(([year, trips]) => ({
        label: String(year),
        trips: trips.sort((a, b) => tripWhen(b).start - tripWhen(a).start),
      }));
    return [...(upcoming.length ? [{ label: "Upcoming", trips: upcoming }] : []), ...past];
  }, [tripsById, query]);

  return createPortal(
    <div className={m.overlay} onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
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
        <p className={m.subtitle}>{subject || "(no subject)"}</p>
        <input
          type="search"
          autoFocus
          className={s.search}
          placeholder="Search trips"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className={s.list}>
          {groups.length === 0 && <p className={s.empty}>No trips match “{query.trim()}”</p>}
          {groups.map((group) => (
            <section key={group.label}>
              <h3 className={s.groupLabel}>{group.label}</h3>
              {group.trips.map((trip) => (
                <button
                  key={trip.id}
                  type="button"
                  className={s.trip}
                  disabled={trip.id === currentTripId}
                  onClick={() => onPick(trip.id)}
                >
                  <Icon name="travel" className={s.tripIcon} style={{ color: TRIP_COLOR }} />
                  <span className={s.tripName}>{trip.name}</span>
                  <span className={s.tripDates}>{formatTripRange(tripWhen(trip))}</span>
                  {trip.id === currentTripId && <Icon name="check" className={s.tripIcon} />}
                </button>
              ))}
            </section>
          ))}
        </div>
        <div className={m.actions}>
          <button type="button" className={m.cancelBtn} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

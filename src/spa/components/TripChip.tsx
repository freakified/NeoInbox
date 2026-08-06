/**
 * "Why is this in my trip?" — shown above a thread that belongs to a trip.
 *
 * Trips are the one grouping the user never configured: bundles are backed by
 * rules they wrote, but trip membership is inferred from reservation data they
 * never see. This is where that inference is made accountable — which trip,
 * what evidence put it there, and a way out — so the answer is at hand exactly
 * when the question comes up, rather than buried in a settings page.
 */
import { useMemo } from "react";
import {
  describeTripReason,
  formatTripRange,
  tripKeysOfThread,
  tripMembershipOfThread,
} from "../../shared/trips";
import type { Thread } from "../../shared/types";
import { useMailStore, useTripMemberships, useTrips } from "../../store/mailStore";
import { navigateToView } from "../lib/routing";
import { Icon } from "./Icon";
import { TRIP_COLOR } from "./TripSliceRow";
import s from "./TripChip.module.css";

export const TripChip = ({ thread }: { thread: Thread }) => {
  const tripsById = useTrips();
  const tripMemberships = useTripMemberships();
  const setTripMembership = useMailStore((st) => st.setTripMembership);

  const membership = useMemo(
    () => tripMembershipOfThread(thread, tripMemberships),
    [thread, tripMemberships],
  );
  // No membership, a tombstone, or a membership pointing at a deleted trip all
  // render as no trip at all — which is how the stream treats them too.
  if (!membership?.tripId) return null;
  const trip = tripsById[membership.tripId];
  if (!trip) return null;

  const range =
    trip.startDate && trip.endDate
      ? formatTripRange({ start: trip.startDate, end: trip.endDate })
      : null;

  return (
    <div className={s.chip} style={{ "--trip-color": TRIP_COLOR } as React.CSSProperties}>
      <Icon name="travel" className={s.icon} />
      <div className={s.text}>
        <span>
          In{" "}
          <button
            type="button"
            className={s.tripLink}
            onClick={() => navigateToView({ type: "trips" })}
          >
            {trip.name}
          </button>
          {range && <span className={s.dates}> · {range}</span>}
        </span>
        <span className={s.reason}>{describeTripReason(membership.reason)}</span>
      </div>
      <button
        type="button"
        className={s.remove}
        title={`Remove from ${trip.name}`}
        onClick={() => setTripMembership(tripKeysOfThread(thread), null)}
      >
        <Icon name="close" className={s.removeIcon} />
      </button>
    </div>
  );
};

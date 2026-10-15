import { useEffect, useMemo, useState } from "react";
import { buildItinerary, type ItineraryItem } from "../../shared/itinerary";
import { log } from "../../shared/log";
import { db } from "../../store/db";
import { useTripMemberships } from "../../store/mailStore";

/**
 * The itinerary for a trip, built from the reservations of every member —
 * archived mail included, since the booking email is usually long done by the
 * time the trip comes around. Reloads whenever the membership set changes
 * (a recluster, a manual move).
 */
export const useTripItinerary = (tripId: string): ItineraryItem[] => {
  const memberships = useTripMemberships();
  const keys = useMemo(
    () =>
      Object.values(memberships)
        .filter((m) => m.tripId === tripId)
        .map((m) => m.key)
        .sort(),
    [memberships, tripId],
  );
  // Stable across unrelated membership changes, so other trips' moves don't
  // reload this one.
  const keysSignature = keys.join("\n");
  const [items, setItems] = useState<ItineraryItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    db.reservations
      .bulkGet(keys)
      .then((records) => {
        if (cancelled) return;
        setItems(buildItinerary(records.filter((r) => r !== undefined)));
      })
      .catch((e) => log.warn("trips", "itinerary load failed", e));
    return () => {
      cancelled = true;
    };
  }, [keysSignature]);

  return items;
};

import type { MessageKey } from "../shared/messageKey";
import { send } from "./portClient";
import type { MailStore, StoreGet, StoreSet } from "./storeTypes";
import type { TripWrite } from "../shared/messaging";
import { pinKeyOf } from "../shared/pinKey";
import type { TripMembershipRecord, TripRecord } from "../shared/types";

/**
 * Trip edits go to the background, which is the one writer to the trip
 * tables: the auto-clusterer writes them too, and the two have to queue.
 */
const writeTrips = (change: Partial<TripWrite>): void => {
  send({
    type: "write-trips",
    trips: change.trips ?? [],
    memberships: change.memberships ?? [],
    deleteTripIds: change.deleteTripIds ?? [],
    deleteMembershipKeys: change.deleteMembershipKeys ?? [],
  });
};

/**
 * Trashed mail leaves its trip for good once the undo window closes, and a
 * trip left with no mail goes with it — Inbox trips, like its other bundles,
 * stopped existing when they had nothing in them. The rows become tombstones
 * so the auto-clusterer, which still has the trashed mail's reservations,
 * doesn't put the trip back.
 */
export const retireTrashedFromTrips = (
  get: StoreGet,
  set: StoreSet,
  messageKeys: MessageKey[],
): void => {
  const memberships = { ...get().tripMembershipByKey };
  const tombstones: TripMembershipRecord[] = [];
  const vacated = new Set<string>();
  for (const messageKey of messageKeys) {
    const message = get().pendingOps[messageKey]?.message;
    if (!message) continue;
    const key = pinKeyOf(message);
    const tripId = memberships[key]?.tripId;
    if (!tripId) continue;
    vacated.add(tripId);
    const tombstone: TripMembershipRecord = { key, tripId: null, source: "manual", addedAt: Date.now() };
    memberships[key] = tombstone;
    tombstones.push(tombstone);
  }
  if (!tombstones.length) return;
  const trips = { ...get().tripsById };
  const emptied = [...vacated].filter(
    (id) => !Object.values(memberships).some((r) => r.tripId === id),
  );
  for (const id of emptied) delete trips[id];
  set({ tripMembershipByKey: memberships, tripsById: trips });
  writeTrips({ memberships: tombstones, deleteTripIds: emptied });
};

export const tripsSlice = (
  set: StoreSet,
  get: StoreGet,
): Pick<
  MailStore,
  "createTrip" | "renameTrip" | "setTripMembership" | "scanTrips" | "stopTripScan"
> => ({
  createTrip: (name) => {
    const record: TripRecord = {
      id: crypto.randomUUID(),
      name: name.trim() || "New trip",
      nameIsCustom: !!name.trim(),
      createdAt: Date.now(),
    };
    set({ tripsById: { ...get().tripsById, [record.id]: record } });
    writeTrips({ trips: [record] });
    return record;
  },
  renameTrip: (id, name) => {
    const prev = get().tripsById[id];
    const trimmed = name.trim();
    if (!prev || !trimmed || prev.name === trimmed) return;
    const next: TripRecord = { ...prev, name: trimmed, nameIsCustom: true };
    set({ tripsById: { ...get().tripsById, [id]: next } });
    writeTrips({ trips: [next] });
  },
  setTripMembership: (keys, tripId) => {
    if (keys.length === 0) return;
    const now = Date.now();
    const destination = tripId ? get().tripsById[tripId] : undefined;
    const previous = keys
      .map((key) => get().tripMembershipByKey[key])
      .filter((r): r is TripMembershipRecord => !!r);
    // Trips these keys are leaving, and so might be the last mail in.
    const vacated = new Set(
      previous
        .map((r) => r.tripId)
        .filter((id): id is string => !!id && id !== tripId),
    );

    const records = keys.map(
      (key): TripMembershipRecord => ({
        key,
        tripId,
        source: "manual",
        addedAt: now,
        // Tombstones (tripId null) carry no reason — there's no membership to
        // explain, and a stale one would surface on a later re-add.
        reason: tripId ? { kind: "manual" } : undefined,
      }),
    );
    const memberships = { ...get().tripMembershipByKey };
    for (const r of records) memberships[r.key] = r;

    // Google Inbox deleted a trip the moment its last message left, rather
    // than leaving an empty shell to be tidied up by hand.
    //
    // "Empty" means no membership row points at it — never "no visible
    // threads". The stream hides snoozed mail and, outside the trip view,
    // archived mail, so a trip whose flights are all snoozed until next month
    // has zero visible threads and is very much alive. Deciding this from the
    // stream would delete it.
    const trips = { ...get().tripsById };
    const emptied: TripRecord[] = [];
    for (const id of vacated) {
      const trip = trips[id];
      if (!trip) continue;
      if (Object.values(memberships).some((r) => r.tripId === id)) continue;
      emptied.push(trip);
      delete trips[id];
    }

    set({ tripMembershipByKey: memberships, tripsById: trips });
    writeTrips({ memberships: records, deleteTripIds: emptied.map((t) => t.id) });

    const emptiedNames = emptied.map((t) => t.name).join(", ");
    const message = destination
      ? emptied.length
        ? `Moved to ${destination.name} · ${emptiedNames} was empty and was deleted`
        : `Moved to ${destination.name}`
      : emptied.length
        ? `Removed from trip · ${emptiedNames} was empty and was deleted`
        : "Removed from trip";

    get().notify(message, [
      {
        label: "Undo",
        run: () => {
          const restoredMemberships = { ...get().tripMembershipByKey };
          for (const key of keys) delete restoredMemberships[key];
          for (const r of previous) restoredMemberships[r.key] = r;
          const restoredTrips = { ...get().tripsById };
          for (const trip of emptied) restoredTrips[trip.id] = trip;
          set({
            tripMembershipByKey: restoredMemberships,
            tripsById: restoredTrips,
          });
          writeTrips({
            trips: emptied,
            memberships: previous,
            deleteMembershipKeys: keys.filter((key) => !previous.some((r) => r.key === key)),
          });
        },
      },
    ]);
  },
  scanTrips: ({ archive, rebuild, importSince, inboxSince }) => {
    if (get().tripScan?.running) return;
    // Optimistic, so the button flips at once; the background confirms.
    const phase = importSince === undefined && inboxSince === undefined ? "read" : "import";
    const fromInbox = inboxSince !== undefined || undefined;
    set({
      tripScan: {
        ...get().tripScan,
        running: true,
        archive,
        rebuild,
        processed: 0,
        total: 0,
        phase,
        fromInbox,
      },
    });
    send({ type: "trip-scan", archive, rebuild, importSince, inboxSince });
  },
  stopTripScan: () => send({ type: "trip-scan-cancel" }),
});

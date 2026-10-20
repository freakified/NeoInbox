/**
 * Whether travel mail is grouped into trips (on by default) or filed in a
 * plain Travel bundle like the other built-ins. Google Inbox itself shipped
 * with a Travel bundle and only grew Trips about a year in. Lives in
 * storage.local because the background classifies with it.
 *
 * Turning trips off keeps every trip, membership and reservation: they are
 * just not shown or swept, so turning them back on restores trips as they
 * were.
 */
export const TRIPS_ENABLED_KEY = "tripsEnabled";

let cached: Promise<boolean> | null = null;

const read = async (): Promise<boolean> => {
  // Unit tests classify without a messenger; trips are the default.
  if (typeof messenger === "undefined") return true;
  const stored = await messenger.storage.local.get(TRIPS_ENABLED_KEY);
  return stored[TRIPS_ENABLED_KEY] !== false;
};

/** Cached: the classifier asks once per message. */
export const getTripsEnabled = (): Promise<boolean> => {
  cached ??= read().catch(() => {
    cached = null;
    return true;
  });
  return cached;
};

export const setTripsEnabled = async (enabled: boolean): Promise<void> => {
  cached = Promise.resolve(enabled);
  await messenger.storage.local.set({ [TRIPS_ENABLED_KEY]: enabled });
};

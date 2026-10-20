import { CATEGORIES, visibleCategories } from "../../shared/categories";
import type { BuiltinCategory, Category, TripRecord } from "../../shared/types";
import { useCustomBundles, useMailStore } from "../../store/mailStore";
import { Icon } from "./Icon";
import { TRIP_COLOR } from "./TripSliceRow";
import s from "./BundleMenu.module.css";

// Trips aren't in this list because they aren't categories — they're appended
// separately below, from the live trip records. Travel is, for when trips are
// off.
const MOVE_DESTINATIONS: BuiltinCategory[] = [
  "personal",
  ...(Object.entries(CATEGORIES)
    .filter(([cat]) => cat !== "personal")
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([cat]) => cat as BuiltinCategory)),
];

/**
 * The "Move to" list: bundles, nearby trips, and the ways to make a new one.
 * Shared by the per-conversation menu and the selection bar; the caller owns
 * what each choice does and closes its own menu.
 */
export const MoveDestinations = ({
  currentCategory,
  currentTripId,
  suggestedTrips,
  moreTrips,
  canRemoveFromTrip,
  onCategory,
  onTrip,
  onMoreTrips,
  onRemoveFromTrip,
  onNewTrip,
  onNewBundle,
}: {
  /** Checked and disabled in the list; null when there isn't a single one. */
  currentCategory: Category | null;
  currentTripId: string | null;
  suggestedTrips: TripRecord[];
  moreTrips: boolean;
  canRemoveFromTrip: boolean;
  onCategory: (target: Category) => void;
  onTrip: (tripId: string) => void;
  onMoreTrips: () => void;
  onRemoveFromTrip: () => void;
  onNewTrip: () => void;
  onNewBundle: () => void;
}) => {
  const customBundles = useCustomBundles();
  const tripsEnabled = useMailStore((st) => st.tripsEnabled);

  return (
    <>
      <div className={s.menuScroll}>
        {visibleCategories(MOVE_DESTINATIONS, tripsEnabled).map((cat) => (
          <DestinationItem
            key={cat}
            name={CATEGORIES[cat].name}
            icon={CATEGORIES[cat].icon}
            color={CATEGORIES[cat].color}
            current={currentCategory === cat}
            onClick={() => onCategory(cat)}
          />
        ))}
        {customBundles.map((bundle) => (
          <DestinationItem
            key={bundle.id}
            name={bundle.name}
            icon={bundle.icon}
            color={bundle.color}
            current={currentCategory === bundle.id}
            onClick={() => onCategory(bundle.id)}
          />
        ))}
        {tripsEnabled && suggestedTrips.map((trip) => (
          <DestinationItem
            key={trip.id}
            name={trip.name}
            icon="travel"
            color={TRIP_COLOR}
            current={currentTripId === trip.id}
            onClick={() => onTrip(trip.id)}
          />
        ))}
      </div>
      {tripsEnabled && moreTrips && (
        <button type="button" className={s.menuItem} role="menuitem" onClick={onMoreTrips}>
          <Icon name="travel_explore" className={s.menuIcon} />
          <span className={s.menuItemLabel}>More trips…</span>
        </button>
      )}
      {tripsEnabled && canRemoveFromTrip && (
        <button type="button" className={s.menuItem} role="menuitem" onClick={onRemoveFromTrip}>
          <Icon name="close" className={s.menuIcon} />
          <span className={s.menuItemLabel}>Remove from trip</span>
        </button>
      )}
      {tripsEnabled && (
        <button type="button" className={s.menuItem} role="menuitem" onClick={onNewTrip}>
          <Icon name="travel" className={s.menuIcon} />
          <span className={s.menuItemLabel}>New trip…</span>
        </button>
      )}
      <button type="button" className={s.menuItem} role="menuitem" onClick={onNewBundle}>
        <Icon name="add" className={s.menuIcon} />
        <span className={s.menuItemLabel}>New bundle…</span>
      </button>
    </>
  );
};

const DestinationItem = ({
  name,
  icon,
  color,
  current,
  onClick,
}: {
  name: string;
  icon: string;
  color: string;
  current: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    className={s.menuItem}
    role="menuitem"
    disabled={current}
    onClick={onClick}
  >
    <Icon name={icon} className={s.menuIcon} style={{ color }} />
    <span className={s.menuItemLabel}>{name}</span>
    {current && <Icon name="check" className={s.menuCheck} />}
  </button>
);

import type { BuiltinCategory, Category, CustomBundleRecord } from "./types";

export interface CategoryMeta {
  key: string;
  name: string;
  color: string;
  icon: string;
  order: number;
}

export const CATEGORIES: Record<BuiltinCategory, CategoryMeta> = {
  // Only a bundle while trips are off; see visibleCategories.
  travel: {
    key: "neoinbox-travel",
    name: "Travel",
    color: "#9C27B0",
    icon: "travel",
    order: 1,
  },
  finance: {
    key: "neoinbox-finance",
    name: "Finance",
    color: "#34A853",
    icon: "finance_mode",
    order: 2,
  },
  purchases: {
    key: "neoinbox-purchases",
    name: "Purchases",
    color: "#795548",
    icon: "shopping_cart",
    order: 3,
  },
  social: {
    key: "neoinbox-social",
    name: "Social",
    color: "#EA4335",
    icon: "group",
    order: 4,
  },
  updates: {
    key: "neoinbox-updates",
    name: "Updates",
    color: "#FF6D01",
    icon: "flag",
    order: 5,
  },
  promos: {
    key: "neoinbox-promos",
    name: "Promos",
    color: "#00BCD4",
    icon: "sell",
    order: 6,
  },
  forums: {
    key: "neoinbox-forums",
    name: "Forums",
    color: "#174EA6",
    icon: "forum",
    order: 7,
  },
  personal: {
    key: "",
    name: "Inbox",
    color: "#111111",
    icon: "inbox",
    order: 99,
  },
};

/**
 * Legacy Thunderbird tag keys. Early NeoInbox builds stored pin/snooze state
 * as real message tags, and a mailbox they touched may still carry them;
 * sanitizeTags keeps them out of the UI. Never write them again.
 */
export const LEGACY_PINNED_KEY = "neoinbox-pinned";
export const LEGACY_SNOOZED_KEY = "neoinbox-snoozed";
export const NEO_TAG_KEYS: ReadonlySet<string> = new Set(
  [
    ...Object.values(CATEGORIES).map((m) => m.key).filter(Boolean),
    LEGACY_PINNED_KEY,
    LEGACY_SNOOZED_KEY,
  ],
);

/**
 * Built-in categories as listed in the UI: Travel is a bundle only while
 * trips are off, since with trips on it would always be empty.
 */
export const visibleCategories = <T extends string>(
  categories: readonly T[],
  tripsEnabled: boolean,
): T[] => (tripsEnabled ? categories.filter((c) => c !== "travel") : [...categories]);

/** Drops NeoInbox's legacy tag keys, leaving only the user's real tags. */
export const sanitizeTags = (tags: readonly string[] | undefined): string[] =>
  (tags ?? []).filter((t) => !NEO_TAG_KEYS.has(t));

export const getCategoryMeta = (
  category: Category,
  customBundles: readonly CustomBundleRecord[],
): CategoryMeta => {
  const builtin = (CATEGORIES as Record<string, CategoryMeta | undefined>)[category];
  if (builtin) return builtin;
  const custom = customBundles.find((b) => b.id === category);
  if (custom) {
    return { key: "", name: custom.name, color: custom.color, icon: custom.icon, order: custom.order };
  }
  return { key: "", name: category, color: "#9AA0A6", icon: "label", order: 99 };
}

import type { Category } from "./types";

export interface CategoryMeta {
  key: string;
  name: string;
  color: string;
  icon: string;
  order: number;
}

export const CATEGORIES: Record<Category, CategoryMeta> = {
  travel: {
    key: "neoinbox-travel",
    name: "Travel",
    color: "#4285F4",
    icon: "✈",
    order: 1,
  },
  finance: {
    key: "neoinbox-finance",
    name: "Finance",
    color: "#34A853",
    icon: "💰",
    order: 2,
  },
  purchases: {
    key: "neoinbox-purchases",
    name: "Purchases",
    color: "#FBBC04",
    icon: "📦",
    order: 3,
  },
  social: {
    key: "neoinbox-social",
    name: "Social",
    color: "#EA4335",
    icon: "👥",
    order: 4,
  },
  updates: {
    key: "neoinbox-updates",
    name: "Updates",
    color: "#9AA0A6",
    icon: "🔔",
    order: 5,
  },
  promos: {
    key: "neoinbox-promos",
    name: "Promos",
    color: "#FF6D01",
    icon: "📣",
    order: 6,
  },
  forums: {
    key: "neoinbox-forums",
    name: "Forums",
    color: "#9C27B0",
    icon: "💬",
    order: 7,
  },
  personal: {
    key: "",
    name: "Inbox",
    color: "#111111",
    icon: "📨",
    order: 99,
  },
};

export const PINNED_KEY = "neoinbox-pinned";
export const SNOOZED_KEY = "neoinbox-snoozed";

export const NEO_TAG_KEYS: ReadonlySet<string> = new Set(
  [
    ...Object.values(CATEGORIES).map((m) => m.key).filter(Boolean),
    PINNED_KEY,
    SNOOZED_KEY,
  ],
);

const TAG_TO_CATEGORY: ReadonlyMap<string, Category> = new Map(
  Object.entries(CATEGORIES)
    .filter(([, m]) => m.key)
    .map(([cat, m]) => [m.key, cat as Category]),
);

export function categoryFromTags(tags: readonly string[]): Category | null {
  for (const t of tags) {
    const cat = TAG_TO_CATEGORY.get(t);
    if (cat) return cat;
  }
  return null;
}

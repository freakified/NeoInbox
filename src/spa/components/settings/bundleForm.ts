import { CATEGORIES } from "../../../shared/categories";
import { normalizeRuleValue } from "../../../shared/routeRules";
import type { BuiltinCategory, RouteRuleRecord, RouteRuleType } from "../../../shared/types";

export type RuleType = RouteRuleType;
export interface DraftRule {
  type: RuleType;
  value: string;
}
export type SelectedBundle = { kind: "builtin"; id: BuiltinCategory } | { kind: "custom"; id: string } | { kind: "new" };
export type SelectedPane =
  | { kind: "general" }
  | { kind: "trips" }
  | { kind: "remoteImages" }
  | { kind: "translation" }
  | SelectedBundle;

export interface BundleFormState {
  id: string;
  name: string;
  color: string;
  icon: string;
  draftRules: DraftRule[];
  order: number;
}

/** Includes "personal" (the unbundled Inbox), sorted last, so its rules stay manageable. */
export const BUNDLE_CATEGORIES = Object.entries(CATEGORIES)
  .sort(([, a], [, b]) => a.order - b.order)
  .map(([cat]) => cat as BuiltinCategory);

export const PRESET_COLORS = [
  "#4285F4", "#34A853", "#FBBC04", "#EA4335",
  "#FF6D01", "#9C27B0", "#00BCD4", "#795548", "#174EA6",
  "#607D8B", "#E91E63", "#009688", "#673AB7",
];

export const CUSTOM_BUNDLE_ICON_GROUPS = [
  {
    label: "General",
    icons: [
      "label", "label_important", "local_offer", "sell", "flag", "bookmark", "star", "favorite",
      "push_pin", "priority_high", "bolt", "auto_awesome", "category", "dashboard", "widgets",
      "folder", "folder_open", "inventory_2", "archive", "history", "schedule", "event", "calendar_month",
    ],
  },
  {
    label: "Mail",
    icons: [
      "inbox", "mail", "drafts", "send", "outbox", "mark_email_unread", "forward_to_inbox",
      "unsubscribe", "notifications", "notifications_active", "campaign", "rss_feed", "alternate_email",
      "contact_mail", "contact_phone", "quickreply",
    ],
  },
  {
    label: "Work",
    icons: [
      "work", "business", "corporate_fare", "badge", "assignment", "assignment_turned_in", "task_alt",
      "checklist", "description", "article", "fact_check", "approval", "groups", "meeting_room",
      "support_agent", "engineering", "construction", "build", "handyman", "print", "scanner",
    ],
  },
  {
    label: "Money",
    icons: [
      "account_balance", "finance_mode", "credit_card", "account_balance_wallet", "savings", "receipt",
      "receipt_long", "payments", "paid", "attach_money", "price_check", "request_quote",
      "trending_up", "trending_down", "query_stats", "monitoring", "currency_exchange", "calculate",
    ],
  },
  {
    label: "Shopping",
    icons: [
      "shopping_bag", "shopping_cart", "add_shopping_cart", "storefront", "store", "redeem",
      "card_giftcard", "sell", "loyalty", "barcode_scanner", "qr_code_scanner", "local_shipping",
      "package_2", "inventory", "warehouse", "confirmation_number",
    ],
  },
  {
    label: "Travel",
    icons: [
      "flight", "travel", "hotel", "luggage", "map", "explore", "near_me", "public", "language",
      "directions_car", "train", "directions_bus", "directions_boat", "local_taxi", "commute",
      "airport_shuttle", "restaurant", "local_cafe", "local_bar", "attractions",
    ],
  },
  {
    label: "People",
    icons: [
      "group", "person", "contacts", "account_circle", "supervisor_account", "diversity_3",
      "family_restroom", "forum", "chat", "chat_bubble", "sms", "reviews", "thumb_up", "volunteer_activism",
      "favorite", "celebration",
    ],
  },
  {
    label: "Learning",
    icons: [
      "school", "local_library", "menu_book", "book", "history_edu", "science", "biotech",
      "psychology", "lightbulb", "tips_and_updates", "extension", "code", "terminal", "data_object",
      "memory", "smart_toy",
    ],
  },
  {
    label: "Lifestyle",
    icons: [
      "home", "apartment", "chair", "kitchen", "yard", "restaurant_menu", "cake", "fitness_center",
      "health_and_safety", "medical_services", "spa", "self_improvement", "music_note", "movie",
      "theaters", "photo_camera", "palette", "brush", "sports_esports", "sports_soccer", "sports_basketball",
      "hiking", "pets",
    ],
  },
  {
    label: "Tech",
    icons: [
      "computer", "desktop_mac", "laptop_mac", "smartphone", "tablet_mac", "devices", "router",
      "wifi", "cloud", "cloud_sync", "sync", "backup", "download", "upload", "security", "key",
      "lock", "vpn_key", "shield", "bug_report", "settings", "tune",
    ],
  },
] as const;

export const CUSTOM_BUNDLE_ICONS: readonly string[] = [
  ...new Set(CUSTOM_BUNDLE_ICON_GROUPS.flatMap((group) => group.icons)),
];

export const ruleDescription = (type: RuleType): string => {
  if (type === "domain") return "Matches any sender at this domain.";
  if (type === "email") return "Matches this exact sender address.";
  return "Matches when the subject includes this text anywhere.";
};

export const rulePreview = (type: RuleType, value: string): string => {
  const normalized = normalizeRuleValue(type, value);
  if (!normalized) return ruleDescription(type);
  if (type === "domain") return `Sender domain is ${normalized}`;
  if (type === "email") return `Sender is ${normalized}`;
  return `Subject contains "${normalized}"`;
};

export const emptyForm = (order: number, seedRule?: DraftRule): BundleFormState => ({
  id: crypto.randomUUID(),
  name: "",
  color: PRESET_COLORS[0]!,
  icon: "label",
  draftRules: seedRule ? [seedRule] : [],
  order,
});

export const bundleKey = (selected: SelectedBundle): string =>
  selected.kind === "new" ? "new" : `${selected.kind}:${selected.id}`;

export const paneKey = (selected: SelectedPane): string =>
  selected.kind === "general" ||
  selected.kind === "trips" ||
  selected.kind === "remoteImages" ||
  selected.kind === "translation"
    ? selected.kind
    : bundleKey(selected);

export const hasDraftRule = (rules: readonly DraftRule[], rule: DraftRule): boolean =>
  rules.some((r) => r.type === rule.type && r.value === rule.value);

/** Winner-first thread matches → per-rule badge; undefined when the rule doesn't match. */
export type RuleBadge = "wins" | "outranked";
export const threadBadge = (
  matches: readonly RouteRuleRecord[],
  ruleId: string,
): RuleBadge | undefined =>
  matches[0]?.id === ruleId
    ? "wins"
    : matches.some((r) => r.id === ruleId)
      ? "outranked"
      : undefined;

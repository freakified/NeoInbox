/**
 * Inbox's famously unhelpful reminder autocomplete: type "house" and it offers
 * "sydney opera house". It drew on Google's search data; we make do with a
 * list of everyday to-dos plus the user's own past reminders.
 */
const COMMON_REMINDERS = [
  "book dentist appointment",
  "book doctor appointment",
  "book flights",
  "book hotel",
  "book restaurant",
  "buy a gift",
  "buy birthday card",
  "buy bread",
  "buy coffee",
  "buy dog food",
  "buy eggs",
  "buy flowers",
  "buy groceries",
  "buy light bulbs",
  "buy milk",
  "buy stamps",
  "buy toilet paper",
  "buy toll house cookies",
  "call grandma",
  "call mom",
  "call dad",
  "call the bank",
  "call the plumber",
  "call the landlord",
  "cancel subscription",
  "change air filter",
  "change oil",
  "charge phone",
  "check email",
  "check tire pressure",
  "clean bathroom",
  "clean garage",
  "clean house",
  "clean kitchen",
  "clean out fridge",
  "do laundry",
  "do taxes",
  "drop off dry cleaning",
  "email boss",
  "feed the cat",
  "feed the dog",
  "file expense report",
  "fill prescription",
  "fix bike",
  "fix leaky faucet",
  "get a haircut",
  "get car washed",
  "get flu shot",
  "go for a run",
  "go to the gym",
  "go to the post office",
  "house insurance",
  "mail package",
  "make dinner reservations",
  "mow the lawn",
  "order pizza",
  "paint house",
  "pay credit card bill",
  "pay electric bill",
  "pay parking ticket",
  "pay phone bill",
  "pay rent",
  "pick up kids",
  "pick up prescription",
  "pick up dry cleaning",
  "plan vacation",
  "print boarding pass",
  "rake leaves",
  "renew driver's license",
  "renew passport",
  "reply to email",
  "return library books",
  "return package",
  "schedule car service",
  "send thank you card",
  "sydney opera house",
  "take out the trash",
  "take out recycling",
  "thank you notes",
  "update resume",
  "vacuum living room",
  "walk the dog",
  "water plants",
  "white house tour",
  "wash car",
  "wash dishes",
];

/** A suggestion split into runs, `typed` for the parts the query matched. */
export type SuggestionPart = { text: string; typed: boolean };

const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Up to `limit` phrases where every typed word starts a different word of
 * the phrase, alphabetical like Inbox's. Exact matches aren't suggested.
 */
export const suggestReminders = (
  query: string,
  past: readonly string[] = [],
  limit = 5,
): SuggestionPart[][] => {
  const typed = words(query);
  if (typed.length === 0) return [];
  const seen = new Set<string>();
  const results: { phrase: string; parts: SuggestionPart[] }[] = [];
  for (const raw of [...past, ...COMMON_REMINDERS]) {
    const phrase = raw.trim().toLowerCase();
    if (!phrase || seen.has(phrase) || phrase === typed.join(" ")) continue;
    seen.add(phrase);
    const parts = matchParts(phrase, typed);
    if (parts) results.push({ phrase, parts });
  }
  return results
    .sort((a, b) => a.phrase.localeCompare(b.phrase))
    .slice(0, limit)
    .map((r) => r.parts);
};

/** The phrase's runs if every typed word prefixes one of its words, else null. */
const matchParts = (phrase: string, typed: string[]): SuggestionPart[] | null => {
  const tokens = phrase.split(/(\s+)/);
  const matched = new Map<number, number>();
  for (const word of typed) {
    const at = tokens.findIndex((t, i) => i % 2 === 0 && !matched.has(i) && t.startsWith(word));
    if (at === -1) return null;
    matched.set(at, word.length);
  }
  const parts: SuggestionPart[] = [];
  const push = (text: string, isTyped: boolean) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.typed === isTyped) last.text += text;
    else parts.push({ text, typed: isTyped });
  };
  tokens.forEach((t, i) => {
    const len = matched.get(i);
    if (len === undefined) {
      push(t, false);
    } else {
      push(t.slice(0, len), true);
      push(t.slice(len), false);
    }
  });
  return parts;
};

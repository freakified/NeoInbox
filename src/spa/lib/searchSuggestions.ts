import { parseSender } from "../../shared/senders";
import { searchTerms } from "../../store/search";

/**
 * What the search box offers under itself as you type: searches you've run
 * before, and people you know (from useKnownContacts). Picking a person
 * searches their address, which finds mail from them and to them.
 */
export type SearchSuggestion =
  | { kind: "recent"; query: string }
  | { kind: "contact"; address: string; name: string; email: string };

const RECENT_KEY = "neoinbox.recentSearches";
const RECENT_KEPT = 8;
const RECENT_SHOWN = 5;
const RECENT_SHOWN_WHILE_TYPING = 3;
const CONTACTS_SHOWN = 5;

export const recentSearches = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === "string") : [];
  } catch {
    return [];
  }
};

/** Puts `query` first among the recent searches; returns the new list. */
export const rememberSearch = (query: string): string[] => {
  const text = query.trim();
  const next = [text, ...recentSearches().filter((q) => q !== text)].slice(0, RECENT_KEPT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private windows and the like: recents just don't stick.
  }
  return next;
};

const fold = (text: string): string => searchTerms(text).join(" ");

/** Every term starts a word of the contact's name or address. */
const contactMatches = (terms: readonly string[], name: string, email: string): boolean => {
  const words = fold(`${name} ${email.replace(/[@._+-]/g, " ")} ${email}`).split(" ");
  return terms.every((term) => words.some((word) => word.startsWith(term)));
};

export const searchSuggestions = (
  text: string,
  contacts: readonly string[],
  recent: readonly string[],
): SearchSuggestion[] => {
  const terms = searchTerms(text);
  if (!terms.length) {
    return recent.slice(0, RECENT_SHOWN).map((query) => ({ kind: "recent", query }));
  }
  const typed = fold(text);
  const recentMatches: SearchSuggestion[] = recent
    .filter((query) => {
      const folded = fold(query);
      return folded !== typed && folded.includes(typed);
    })
    .slice(0, RECENT_SHOWN_WHILE_TYPING)
    .map((query) => ({ kind: "recent", query }));
  const people: SearchSuggestion[] = [];
  for (const address of contacts) {
    const { name, email } = parseSender(address);
    if (!email || !contactMatches(terms, name, email)) continue;
    people.push({ kind: "contact", address, name, email });
    if (people.length >= CONTACTS_SHOWN) break;
  }
  return [...recentMatches, ...people];
};

/** What picking a suggestion searches for. */
export const suggestionQuery = (suggestion: SearchSuggestion): string =>
  suggestion.kind === "recent" ? suggestion.query : suggestion.email;

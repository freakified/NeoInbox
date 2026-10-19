import { db } from "./db";
import type { RawMessage } from "../shared/types";

/**
 * Search over the mail NeoInbox has cached: subject, sender, recipients, the
 * snippet and attachment names. Every term has to start a word somewhere (in
 * any field), so "dinner bo" finds Bo's dinner thread and "conf" finds
 * "confirmed", but "rom" doesn't find "from"; "quoted phrases" match as
 * written. Case and accents don't count. Bodies aren't cached, so they aren't
 * searched; Thunderbird's own search is offered for that.
 */

/** Cap on rows read back from Dexie, newest first; a search this broad wants narrowing anyway. */
export const SEARCH_LIMIT = 500;

const fold = (text: string): string =>
  text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** The query's terms, folded; quoted runs stay one term. */
export const searchTerms = (query: string): string[] => {
  const terms: string[] = [];
  for (const match of fold(query).matchAll(/"([^"]*)"?|(\S+)/g)) {
    const term = (match[1] ?? match[2] ?? "").trim();
    if (term) terms.push(term);
  }
  return terms;
};

// Scripts written with spaces between words, where a match has to start one.
// Elsewhere (Japanese, Chinese, Thai…) there are no word breaks to go by.
const WORDY = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{N}]/u;

/** Where `term` next starts a word in folded `haystack`, from `from` on; -1 if nowhere. */
const findTerm = (haystack: string, term: string, from = 0): number => {
  for (let at = haystack.indexOf(term, from); at >= 0; at = haystack.indexOf(term, at + 1)) {
    const before = haystack[at - 1];
    if (!before || !WORDY.test(before) || !WORDY.test(term[0]!)) return at;
  }
  return -1;
};

// Rows are immutable (every change is a new object), so a row's folded text
// can be kept for as long as the row itself: the stream re-derives often.
const haystacks = new WeakMap<RawMessage, string>();

const haystackOf = (m: RawMessage): string => {
  let haystack = haystacks.get(m);
  if (haystack === undefined) {
    haystack = buildHaystack(m);
    haystacks.set(m, haystack);
  }
  return haystack;
};

const buildHaystack = (m: RawMessage): string =>
  fold(
    [
      m.subject,
      m.author,
      ...m.recipients,
      ...m.ccList,
      m.snippet ?? "",
      ...(m.attachments ?? []).map((a) => a.name),
    ].join("\n"),
  );

/** A predicate for messages matching every term; never matches with no terms. */
export const messageMatcher = (query: string): ((m: RawMessage) => boolean) => {
  const terms = searchTerms(query);
  if (!terms.length) return () => false;
  return (m) => {
    const haystack = haystackOf(m);
    return terms.every((term) => findTerm(haystack, term) >= 0);
  };
};

/** Folded text match for anything else in the stream, e.g. a reminder. */
export const textMatches = (query: string, text: string): boolean => {
  const terms = searchTerms(query);
  const haystack = fold(text);
  return terms.length > 0 && terms.every((term) => findTerm(haystack, term) >= 0);
};

/** The newest cached rows that match, from every origin and account. */
export const searchCachedMail = (query: string): Promise<RawMessage[]> => {
  const matches = messageMatcher(query);
  return db.messages.orderBy("date").reverse().filter(matches).limit(SEARCH_LIMIT).toArray();
};

/**
 * Where the terms occur in `text`, as sorted, merged [start, end) ranges of
 * the original string. Matching runs on folded text, so each folded character
 * remembers the span of the original it came from.
 */
export const highlightRanges = (text: string, terms: readonly string[]): [number, number][] => {
  if (!terms.length || !text) return [];
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = fold(ch);
    // A combining accent folds away; it belongs to the letter before it.
    if (!f && ends.length) ends[ends.length - 1] = i + ch.length;
    folded += f;
    for (let k = 0; k < f.length; k++) {
      starts.push(i);
      ends.push(i + ch.length);
    }
    i += ch.length;
  }
  const found: [number, number][] = [];
  for (const term of terms) {
    for (let at = findTerm(folded, term); at >= 0; at = findTerm(folded, term, at + term.length)) {
      found.push([starts[at]!, ends[at + term.length - 1]!]);
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of found) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
};

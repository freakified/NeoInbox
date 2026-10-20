import { useSyncExternalStore } from "react";
import type { Thread } from "../../shared/types";

const BUNDLE_SEEN_KEY = "neoinbox.bundleSeen";

const listeners = new Set<() => void>();

/** Bundle key → when that bundle was last opened. */
type SeenMap = Record<string, number>;

let cache: { raw: string | null; map: SeenMap } | null = null;

const readMap = (): SeenMap => {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(BUNDLE_SEEN_KEY);
  } catch {
    // Storage unavailable; every bundle starts unseen this session.
  }
  if (cache && cache.raw === raw) return cache.map;
  let map: SeenMap = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) map = parsed as SeenMap;
  } catch {
    // Corrupt value; start over.
  }
  cache = { raw, map };
  return map;
};

export const getBundleSeenAt = (bundleKey: string): number | null => {
  const v = readMap()[bundleKey];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/** Everything in the bundle up to now counts as seen, so its "N new" tag clears. */
export const markBundleSeen = (bundleKey: string, at = Date.now()): void => {
  const map = { ...readMap(), [bundleKey]: at };
  try {
    localStorage.setItem(BUNDLE_SEEN_KEY, JSON.stringify(map));
  } catch {
    // The tag just comes back after a reload.
  }
  for (const listener of listeners) listener();
};

export const useBundleSeenAt = (bundleKey: string): number | null =>
  useSyncExternalStore((onChange) => {
    listeners.add(onChange);
    return () => listeners.delete(onChange);
  }, () => getBundleSeenAt(bundleKey));

/**
 * Conversations with an unread message that arrived after the bundle was last
 * opened, as Inbox's "N new" tag counted them. Reading one elsewhere drops it.
 */
export const countNewThreads = (threads: readonly Thread[], seenAt: number | null): number => {
  if (seenAt === null) return 0;
  return threads.filter((t) =>
    t.messages.some((m) => !m.read && m.date > seenAt),
  ).length;
};

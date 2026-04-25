import { db } from "../store/db";
import type { BuiltinCategory } from "../shared/types";

let cache: Map<string, BuiltinCategory> | null = null;

const loadCache = async (): Promise<Map<string, BuiltinCategory>> => {
  if (cache) return cache;
  const rows = await db.overrides.toArray();
  cache = new Map(rows.map((r) => [r.senderDomain.toLowerCase(), r.category]));
  return cache;
}

export const lookupOverride = async (
  senderDomain: string,
): Promise<BuiltinCategory | null> => {
  if (!senderDomain) return null;
  const c = await loadCache();
  return c.get(senderDomain.toLowerCase()) ?? null;
}

export const setOverride = async (
  senderDomain: string,
  category: BuiltinCategory | null,
): Promise<void> => {
  const key = senderDomain.toLowerCase();
  const c = await loadCache();
  if (category === null) {
    await db.overrides.delete(key);
    c.delete(key);
  } else {
    await db.overrides.put({ senderDomain: key, category });
    c.set(key, category);
  }
}

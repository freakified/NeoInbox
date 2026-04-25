import { db } from "../store/db";
import type { Category } from "../shared/types";

let cache: Map<string, Category> | null = null;

async function loadCache(): Promise<Map<string, Category>> {
  if (cache) return cache;
  const rows = await db.overrides.toArray();
  cache = new Map(rows.map((r) => [r.senderDomain.toLowerCase(), r.category]));
  return cache;
}

export async function lookupOverride(
  senderDomain: string,
): Promise<Category | null> {
  if (!senderDomain) return null;
  const c = await loadCache();
  return c.get(senderDomain.toLowerCase()) ?? null;
}

export async function setOverride(
  senderDomain: string,
  category: Category | null,
): Promise<void> {
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

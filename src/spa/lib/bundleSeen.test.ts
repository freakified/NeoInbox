import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawMessage, Thread } from "../../shared/types";
import { countNewThreads, getBundleSeenAt, markBundleSeen } from "./bundleSeen";

beforeEach(() => {
  // Node's own localStorage stub shadows the DOM one here; give each test a fresh store.
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

const thread = (id: string, ...messages: { date: number; read: boolean }[]): Thread =>
  ({ id, messages: messages as RawMessage[] }) as Thread;

describe("markBundleSeen", () => {
  it("remembers each bundle separately", () => {
    expect(getBundleSeenAt("bundle:promos")).toBeNull();
    markBundleSeen("bundle:promos", 100);
    markBundleSeen("bundle:purchases", 200);
    expect(getBundleSeenAt("bundle:promos")).toBe(100);
    expect(getBundleSeenAt("bundle:purchases")).toBe(200);
  });

  it("survives a corrupt stored value", () => {
    localStorage.setItem("neoinbox.bundleSeen", "{not json");
    expect(getBundleSeenAt("bundle:promos")).toBeNull();
    markBundleSeen("bundle:promos", 100);
    expect(getBundleSeenAt("bundle:promos")).toBe(100);
  });
});

describe("countNewThreads", () => {
  it("counts conversations with unread mail since the bundle was seen", () => {
    const threads = [
      thread("a", { date: 50, read: false }, { date: 150, read: false }),
      thread("b", { date: 160, read: false }),
      thread("c", { date: 170, read: true }),
      thread("d", { date: 90, read: false }),
    ];
    expect(countNewThreads(threads, 100)).toBe(2);
  });

  it("calls nothing new in a bundle never seen", () => {
    expect(countNewThreads([thread("a", { date: 150, read: false })], null)).toBe(0);
  });
});

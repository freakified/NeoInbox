import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  effectiveDefaultAccount,
  setDefaultAccount,
  setUnifiedInbox,
  startingAccountFilter,
  UNIFIED,
} from "./accountPrefs";

const accounts = [{ id: "account1" }, { id: "account2" }];

beforeEach(() => {
  // Node's own localStorage stub shadows the DOM one here; give each test a fresh store.
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

describe("effectiveDefaultAccount", () => {
  it("defaults to the first account", () => {
    expect(effectiveDefaultAccount(accounts, null, false)).toBe("account1");
    expect(effectiveDefaultAccount(accounts, null, true)).toBe("account1");
  });

  it("keeps a chosen account that's still there", () => {
    expect(effectiveDefaultAccount(accounts, "account2", false)).toBe("account2");
  });

  it("falls back to the first account when the chosen one is gone", () => {
    expect(effectiveDefaultAccount(accounts, "account9", false)).toBe("account1");
  });

  it("only opens on the unified inbox while it's enabled", () => {
    expect(effectiveDefaultAccount(accounts, UNIFIED, true)).toBe(UNIFIED);
    expect(effectiveDefaultAccount(accounts, UNIFIED, false)).toBe("account1");
  });
});

describe("startingAccountFilter", () => {
  it("opens on the first account out of the box", () => {
    expect(startingAccountFilter(accounts)).toBe("account1");
  });

  it("shows a single account unfiltered", () => {
    expect(startingAccountFilter([{ id: "account1" }])).toBeNull();
  });

  it("opens unfiltered on the unified inbox", () => {
    setUnifiedInbox(true);
    setDefaultAccount(UNIFIED);
    expect(startingAccountFilter(accounts)).toBeNull();
  });
});

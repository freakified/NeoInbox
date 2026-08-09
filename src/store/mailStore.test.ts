/**
 * Store-level tests: the real SPA store talking over a fake port. No DOM and
 * no background — this covers the logic that produces wrong-looking UI without
 * anything ever rendering, chiefly optimistic updates and their rollback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settle } from "../test/fakeMessenger";
import { boot, type Booted } from "../test/boot";
import { shapes } from "../test/fixtures";
import type { ClientMsg, ServerMsg } from "../shared/messaging";
import type { RawMessage } from "../shared/types";

let app: Booted;

const row = (over: Partial<RawMessage> = {}): RawMessage => ({
  id: 1,
  headerMessageId: "<m1@example.com>",
  subject: "Hello",
  author: "Alex <alex@example.com>",
  recipients: ["me@example.com"],
  ccList: [],
  bccList: [],
  date: Date.now(),
  size: 100,
  read: false,
  folderId: "inbox-a",
  accountId: "a",
  tags: [],
  category: null,
  pinned: false,
  snoozed: false,
  origin: "inbox",
  ...over,
});

const store = () => app.store();

/** Messages the store has sent to the background. */
const sent = (): ClientMsg[] => (app.mail.port?.sent ?? []) as ClientMsg[];

/** Pushes a message from the background to the store. */
const fromBackground = async (msg: ServerMsg): Promise<void> => {
  app.mail.port?.onMessage.emitSync(msg);
  await settle();
};

beforeEach(async () => {
  // No background: these tests speak the port protocol directly, so the far
  // end stays silent and every ServerMsg is the test's own rather than a real
  // reply racing it. loop.test.ts covers the two halves talking to each other.
  app = await boot(shapes.standard(), { wireBackground: false });
});

afterEach(() => vi.useRealTimers());

describe("hydration", () => {
  it("loads cached messages from Dexie and connects", async () => {
    await app.db.messages.put(row());
    await store().init();
    await settle();

    expect(store().hydrated).toBe(true);
    expect(store().messagesById[1]?.subject).toBe("Hello");
    expect(sent()).toContainEqual({ type: "hello" });
  });
});

describe("optimistic done", () => {
  beforeEach(async () => {
    await app.db.messages.put(row());
    await store().init();
    await settle();
  });

  it("moves the row out of the inbox immediately and records a pending op", () => {
    store().doneThread([1]);

    // Flipped rather than deleted, so it stays visible in done/bundle views
    // while the archive round-trip catches up.
    expect(store().messagesById[1]?.origin).toBe("done");
    expect(store().pendingOps[1]?.kind).toBe("done");
    expect(store().toasts.at(-1)?.undo).toEqual({ messageIds: [1], kind: "done" });
  });

  it("restores the original row when the background reports failure", async () => {
    store().doneThread([1]);
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(5_001); // let the undo window commit
    vi.useRealTimers();

    await fromBackground({
      type: "command-failed",
      command: "done",
      messageId: 1,
      reason: "No Archives folder configured for this account",
    });

    // The rollback is what keeps a failed archive from silently eating a row.
    expect(store().messagesById[1]?.origin).toBe("inbox");
    expect(store().pendingOps[1]).toBeUndefined();
    expect(store().toasts.at(-1)?.message).toContain("No Archives folder");
    expect(store().toasts.at(-1)?.retry).toEqual({
      kind: "done",
      messageId: 1,
      wakeAt: undefined,
    });
  });

  it("undo puts the row back without ever sending the command", () => {
    store().doneThread([1]);
    const toastId = store().toasts.at(-1)!.id;

    store().undoToast(toastId);

    expect(store().messagesById[1]?.origin).toBe("inbox");
    expect(sent().some((m) => m.type === "done")).toBe(false);
  });

  it("sends the command once the undo window closes", async () => {
    vi.useFakeTimers();
    store().doneThread([1]);
    expect(sent().some((m) => m.type === "done")).toBe(false);

    await vi.advanceTimersByTimeAsync(5_001);

    expect(sent()).toContainEqual({ type: "done", messageId: 1 });
  });
});

/**
 * Deltas are buffered and flushed as one write. These cover the two things
 * that buys and the one thing it puts at risk: fewer re-renders, unchanged
 * net effect, and no clobbering of a click that lands mid-buffer.
 */
describe("delta coalescing", () => {
  beforeEach(async () => {
    await store().init();
    await settle();
  });

  /** Emits without settling, so several deltas land in one buffer window. */
  const emit = (msg: ServerMsg): void => {
    app.mail.port?.onMessage.emitSync(msg);
  };

  it("applies a burst of deltas as a single store update", async () => {
    let updates = 0;
    const unsubscribe = app.useMailStore.subscribe(() => {
      updates++;
    });

    for (let id = 1; id <= 20; id++) emit({ type: "delta", added: [row({ id })] });
    // Still buffered: a scan's deltas must not each cost a re-thread.
    expect(updates).toBe(0);
    await settle();
    unsubscribe();

    expect(updates).toBe(1);
    expect(Object.keys(store().messagesById)).toHaveLength(20);
  });

  it("nets out an add followed by a removal", async () => {
    emit({ type: "delta", added: [row({ id: 1 })] });
    emit({ type: "delta", removedIds: [1] });
    await settle();

    expect(store().messagesById[1]).toBeUndefined();
  });

  it("nets out a removal followed by a re-add", async () => {
    await fromBackground({ type: "delta", added: [row({ id: 1 })] });

    emit({ type: "delta", removedIds: [1] });
    emit({ type: "delta", added: [row({ id: 1, read: true })] });
    await settle();

    expect(store().messagesById[1]?.read).toBe(true);
  });

  it("does not let a buffered delta overwrite a click that beats the flush", async () => {
    await fromBackground({ type: "delta", added: [row({ id: 1 })] });

    // The delta is still in the buffer when the user pins the row. Applying it
    // afterwards would revert the pin on screen until the next delta arrived.
    emit({ type: "delta", updated: [row({ id: 1, read: true })] });
    store().pin(1, true);
    await settle();

    expect(store().messagesById[1]?.pinned).toBe(true);
    expect(store().messagesById[1]?.read).toBe(true);
  });
});

describe("deltas from the background", () => {
  beforeEach(async () => {
    await store().init();
    await settle();
  });

  it("adds, updates and removes rows", async () => {
    await fromBackground({ type: "delta", added: [row({ id: 1 })] });
    expect(store().messagesById[1]).toBeDefined();

    await fromBackground({ type: "delta", updated: [row({ id: 1, read: true })] });
    expect(store().messagesById[1]?.read).toBe(true);

    await fromBackground({ type: "delta", removedIds: [1] });
    expect(store().messagesById[1]).toBeUndefined();
  });

  it("re-keys a row whose id the background re-resolved", async () => {
    await fromBackground({ type: "delta", added: [row({ id: 1 })] });

    // What a reclassify does after Thunderbird renumbers a message.
    await fromBackground({
      type: "delta",
      added: [row({ id: 99 })],
      removedIds: [1],
    });

    expect(store().messagesById[1]).toBeUndefined();
    expect(store().messagesById[99]).toBeDefined();
  });

  it("clears a pending op when the real row lands", async () => {
    await fromBackground({ type: "delta", added: [row({ id: 1 })] });
    store().doneThread([1]);
    expect(store().pendingOps[1]).toBeDefined();

    await fromBackground({ type: "delta", updated: [row({ id: 1, origin: "done" })] });

    expect(store().pendingOps[1]).toBeUndefined();
  });
});

describe("reconnect", () => {
  beforeEach(async () => {
    await store().init();
    await settle();
  });

  it("queues commands issued while the port is down and flushes them on reconnect", async () => {
    await fromBackground({ type: "delta", added: [row({ id: 1 })] });

    // Faked before the disconnect so the reconnect backoff timer is faked too.
    vi.useFakeTimers();
    const before = app.mail.port!;
    before.disconnect();
    expect(store().connectionState).toBe("reconnecting");

    store().pin(1, true);
    // Nothing can go out yet; dropping it would silently lose a mutation the
    // optimistic UI has already applied on screen.
    expect(before.sent.some((m) => (m as ClientMsg).type === "pin")).toBe(false);

    await vi.advanceTimersByTimeAsync(600); // reconnect backoff

    expect(store().connectionState).toBe("connected");
    expect(sent()).toContainEqual({ type: "pin", messageId: 1, pinned: true });
  });

  it("unsticks the reclassify button when the port dies mid-run", async () => {
    store().reclassify();
    expect(store().reclassifying).toBe(true);

    app.mail.port!.disconnect();

    expect(store().reclassifying).toBe(false);
  });
});

describe("progress and reclassify reporting", () => {
  beforeEach(async () => {
    await store().init();
    await settle();
  });

  it("surfaces scan progress", async () => {
    await fromBackground({
      type: "backfill-progress",
      scanned: 120,
      classified: 30,
      done: false,
    });

    expect(store().syncProgress).toMatchObject({ scanned: 120, classified: 30, done: false });
  });

  it("reports a reclassify that changed nothing without implying failure", async () => {
    store().reclassify();
    await fromBackground({ type: "reclassify-done", scanned: 544, moved: 0 });

    expect(store().reclassifying).toBe(false);
    expect(store().toasts.at(-1)?.message).toContain("everything already in place");
  });

  it("reports how many messages moved", async () => {
    store().reclassify();
    await fromBackground({ type: "reclassify-done", scanned: 544, moved: 133 });

    expect(store().toasts.at(-1)?.message).toContain("133 moved");
  });
});

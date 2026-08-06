/**
 * Derivation tests: cached messages in, stream rows out. No DOM, no fakes —
 * deriveStream is pure, and it is where "does the inbox look right for this
 * mailbox" is actually decided.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveStream, type StreamItem, type StreamView } from "./stream";
import type {
  RawMessage,
  ReminderRecord,
  SnoozeRecord,
  TripMembershipRecord,
  TripRecord,
} from "../shared/types";

const NOW = Date.UTC(2026, 7, 5, 12, 0, 0);
const MINUTE = 60_000;

let nextId = 1;

const msg = (over: Partial<RawMessage> = {}): RawMessage => ({
  id: nextId++,
  headerMessageId: `<m${nextId}@example.com>`,
  subject: `Subject ${nextId}`,
  author: "Alex <alex@example.com>",
  recipients: ["me@example.com"],
  ccList: [],
  bccList: [],
  date: NOW - MINUTE,
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

const byId = (messages: RawMessage[]): Record<number, RawMessage> =>
  Object.fromEntries(messages.map((m) => [m.id, m]));

const ME = new Set(["me@example.com"]);

const stream = (messages: RawMessage[], view: StreamView = { type: "inbox" }, ...rest: unknown[]) =>
  deriveStream(
    byId(messages),
    ME,
    view,
    ...(rest as [Record<number, SnoozeRecord>?, boolean?, Record<string, ReminderRecord>?, Record<string, TripRecord>?, Record<string, TripMembershipRecord>?]),
  );

const items = (s: { sections: { items: StreamItem[] }[] }): StreamItem[] =>
  s.sections.flatMap((section) => section.items);

const kinds = (s: { sections: { items: StreamItem[] }[] }): string[] =>
  items(s).map((i) => i.type);

beforeEach(() => {
  nextId = 1;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

describe("inbox view", () => {
  it("groups categorised mail into one row per bundle", () => {
    const s = stream([
      msg({ category: "promos" }),
      msg({ category: "promos" }),
      msg({ category: "forums" }),
      msg({ category: null }),
    ]);

    const bundles = items(s).filter((i) => i.type === "bundle");
    expect(bundles).toHaveLength(2);
    expect(kinds(s).filter((k) => k === "thread")).toHaveLength(1);
  });

  it("surfaces pinned mail individually instead of hiding it in a bundle", () => {
    const s = stream([
      msg({ category: "promos", pinned: true }),
      msg({ category: "promos" }),
    ]);

    // The pinned one must be its own row, or pinning something inside a
    // bundle would look like it did nothing.
    expect(kinds(s).sort()).toEqual(["bundle", "thread"]);
  });

  it("hides snoozed mail", () => {
    const s = stream([msg({ snoozed: true }), msg()]);
    expect(kinds(s)).toEqual(["thread"]);
  });

  it("orders rows newest first", () => {
    const s = stream([
      msg({ date: NOW - 5 * MINUTE, subject: "older" }),
      msg({ date: NOW - MINUTE, subject: "newer" }),
    ]);

    const dates = items(s).map((i) => i.date);
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it("keeps accounts separate when the same subject appears in both", () => {
    const s = stream([
      msg({ accountId: "a", folderId: "inbox-a", subject: "Invoice" }),
      msg({ accountId: "b", folderId: "inbox-b", subject: "Invoice" }),
    ]);

    // Two accounts, two threads — not one merged thread.
    expect(s.threadCount).toBe(2);
  });
});

describe("bundle view", () => {
  it("includes archived mail alongside inbox mail", () => {
    const s = stream(
      [
        msg({ category: "promos", origin: "inbox" }),
        msg({ category: "promos", origin: "done" }),
        msg({ category: "promos", origin: "inbox", snoozed: true }),
      ],
      { type: "bundle", category: "promos" },
    );

    // Done rows belong to the bundle; snoozed ones don't.
    expect(s.threadCount).toBe(2);
  });

  it("excludes mail from other bundles", () => {
    const s = stream(
      [msg({ category: "promos" }), msg({ category: "forums" })],
      { type: "bundle", category: "promos" },
    );
    expect(s.threadCount).toBe(1);
  });
});

describe("done, sent and draft views", () => {
  it("shows only archived mail in the done view", () => {
    const s = stream(
      [msg({ origin: "done" }), msg({ origin: "inbox" })],
      { type: "done" },
    );
    expect(s.threadCount).toBe(1);
  });

  it("shows only drafts in the draft view", () => {
    const s = stream(
      [msg({ origin: "draft" }), msg({ origin: "inbox" }), msg({ origin: "sent" })],
      { type: "draft" },
    );
    expect(s.threadCount).toBe(1);
  });
});

describe("snoozed view", () => {
  it("orders by wake time ascending and drops rows with no snooze record", () => {
    const soon = msg({ snoozed: true });
    const later = msg({ snoozed: true });
    const orphan = msg({ snoozed: true });

    const s = stream(
      [soon, later, orphan],
      { type: "snoozed" },
      {
        [soon.id]: { messageId: soon.id, wakeAt: NOW + MINUTE } as SnoozeRecord,
        [later.id]: { messageId: later.id, wakeAt: NOW + 10 * MINUTE } as SnoozeRecord,
      },
    );

    const dates = items(s).map((i) => i.date);
    expect(dates).toEqual([NOW + MINUTE, NOW + 10 * MINUTE]);
  });
});

describe("trips", () => {
  const trip: TripRecord = {
    id: "trip-1",
    name: "Lisbon",
    createdAt: NOW - 10 * MINUTE,
  } as TripRecord;

  const membership = (m: RawMessage): TripMembershipRecord =>
    ({ key: m.headerMessageId, tripId: trip.id, source: "auto" }) as TripMembershipRecord;

  it("renders a trip as its own row in the inbox stream", () => {
    const a = msg();
    const s = stream(
      [a, msg()],
      { type: "inbox" },
      {},
      false,
      {},
      { [trip.id]: trip },
      { [a.headerMessageId]: membership(a) },
    );

    expect(kinds(s).sort()).toEqual(["thread", "trip"]);
  });

  it("pulls in non-travel mail that was manually added to a trip", () => {
    const a = msg({ category: "purchases" });
    const s = stream(
      [a],
      { type: "trips" },
      {},
      false,
      {},
      { [trip.id]: trip },
      { [a.headerMessageId]: membership(a) },
    );

    const tripItem = items(s).find((i) => i.type === "trip");
    expect(tripItem && tripItem.type === "trip" && tripItem.threads).toHaveLength(1);
  });

  it("shows a trip with no visible mail in the trips view but not the inbox", () => {
    // A trip with zero members is deleted outright, so this is the live case:
    // a real trip whose mail is currently snoozed. It must stay on the trips
    // page — the mail is coming back — while staying out of today's inbox.
    const a = msg({ snoozed: true });
    const args = [
      {},
      false,
      {},
      { [trip.id]: trip },
      { [a.headerMessageId]: membership(a) },
    ] as const;
    const inTripsView = stream([a], { type: "trips" }, ...args);
    const inInbox = stream([a], { type: "inbox" }, ...args);

    expect(kinds(inTripsView)).toEqual(["trip"]);
    expect(kinds(inInbox)).toEqual([]);
  });

  it("renders a membership pointing at a deleted trip as loose mail", () => {
    const a = msg();
    const s = stream(
      [a],
      { type: "inbox" },
      {},
      false,
      {},
      {},
      { [a.headerMessageId]: membership(a) },
    );

    expect(kinds(s)).toEqual(["thread"]);
  });
});

describe("reminders", () => {
  const reminder = (over: Partial<ReminderRecord> = {}): ReminderRecord => ({
    id: `r${nextId++}`,
    text: "Call the dentist",
    createdAt: NOW - MINUTE,
    status: "active",
    pinned: false,
    ...over,
  });

  it("mixes active reminders into the inbox stream", () => {
    const r = reminder();
    const s = stream([msg()], { type: "inbox" }, {}, false, { [r.id]: r });
    expect(kinds(s).sort()).toEqual(["reminder", "thread"]);
  });

  it("moves a snoozed reminder out of the inbox and into the snoozed view", () => {
    const r = reminder({ snoozeWakeAt: NOW + MINUTE });
    const args = [{}, false, { [r.id]: r }] as const;

    expect(kinds(stream([], { type: "inbox" }, ...args))).toEqual([]);
    expect(kinds(stream([], { type: "snoozed" }, ...args))).toEqual(["reminder"]);
  });

  it("shows completed reminders in the done view only", () => {
    const r = reminder({ status: "done", doneAt: NOW - MINUTE });
    const args = [{}, false, { [r.id]: r }] as const;

    expect(kinds(stream([], { type: "done" }, ...args))).toEqual(["reminder"]);
    expect(kinds(stream([], { type: "inbox" }, ...args))).toEqual([]);
  });
});

describe("pinned-only filter", () => {
  it("keeps pinned threads and pinned reminders, drops the rest", () => {
    const pinnedReminder: ReminderRecord = {
      id: "r1",
      text: "pinned",
      createdAt: NOW - MINUTE,
      status: "active",
      pinned: true,
    };
    const looseReminder: ReminderRecord = { ...pinnedReminder, id: "r2", pinned: false };

    const s = stream(
      [msg({ pinned: true }), msg({ pinned: false })],
      { type: "inbox" },
      {},
      true,
      { r1: pinnedReminder, r2: looseReminder },
    );

    expect(kinds(s).sort()).toEqual(["reminder", "thread"]);
  });
});

describe("date sections", () => {
  it("buckets rows by age, newest section first", () => {
    const s = stream([
      msg({ date: NOW - MINUTE }),
      msg({ date: NOW - 26 * 60 * MINUTE }),
    ]);

    expect(s.sections.map((sec) => sec.label)).toEqual(["Today", "Yesterday"]);
  });
});

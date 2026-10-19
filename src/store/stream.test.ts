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
  key: `k${nextId}`,
  tbId: nextId++,
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

const byKey = (messages: RawMessage[]): Record<string, RawMessage> =>
  Object.fromEntries(messages.map((m) => [m.key, m]));

const ME = new Set(["me@example.com"]);

const stream = (messages: RawMessage[], view: StreamView = { type: "inbox" }, ...rest: unknown[]) =>
  deriveStream(
    byKey(messages),
    ME,
    view,
    ...(rest as [Record<string, SnoozeRecord>?, boolean?, Record<string, ReminderRecord>?, Record<string, TripRecord>?, Record<string, TripMembershipRecord>?, (string | null)?]),
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
        [soon.key]: { messageKey: soon.key, wakeAt: NOW + MINUTE } as SnoozeRecord,
        [later.key]: { messageKey: later.key, wakeAt: NOW + 10 * MINUTE } as SnoozeRecord,
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

  it("keeps a trip whose mail is all snoozed in the trips view, but not the inbox", () => {
    // Trips with no mail don't exist anywhere, so snoozed mail has to count
    // on the trips page — it's coming back — while staying out of the inbox.
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

  it("never shows a trip with no mail, even in the trips view", () => {
    const s = stream([], { type: "trips" }, {}, false, {}, { [trip.id]: trip }, {});
    expect(kinds(s)).toEqual([]);
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

describe("one account", () => {
  const trip: TripRecord = { id: "trip-1", name: "Lisbon", createdAt: NOW - 10 * MINUTE } as TripRecord;
  const membership = (m: RawMessage): TripMembershipRecord =>
    ({ key: m.headerMessageId, tripId: trip.id, source: "auto" }) as TripMembershipRecord;
  const ofB = (over: Partial<RawMessage> = {}) => msg({ accountId: "b", folderId: "inbox-b", ...over });

  it("shows only that account's threads, and every account's with no filter", () => {
    const a = msg({ subject: "From a" });
    const b = ofB({ subject: "From b" });
    const subjects = (accountId: string | null) =>
      items(stream([a, b], { type: "inbox" }, {}, false, {}, {}, {}, accountId)).map(
        (i) => i.type === "thread" && i.thread.subject,
      );

    expect(subjects("a")).toEqual(["From a"]);
    expect(subjects("b")).toEqual(["From b"]);
    expect(subjects(null).sort()).toEqual(["From a", "From b"]);
  });

  it("keeps the same message delivered to two accounts as two threads", () => {
    const a = msg({ headerMessageId: "<same@example.com>" });
    const b = ofB({ headerMessageId: "<same@example.com>" });
    const s = stream([a, b], { type: "inbox" }, {}, false, {}, {}, {}, null);

    expect(kinds(s)).toEqual(["thread", "thread"]);
  });

  it("shows a trip whole in every account it has mail from", () => {
    const flight = msg();
    const hotel = ofB();
    const memberships = { [flight.headerMessageId]: membership(flight), [hotel.headerMessageId]: membership(hotel) };
    const tripThreads = (view: StreamView, accountId: string) => {
      const item = items(
        stream([flight, hotel], view, {}, false, {}, { [trip.id]: trip }, memberships, accountId),
      ).find((i) => i.type === "trip");
      return item?.type === "trip" ? item.threads.length : 0;
    };

    expect(tripThreads({ type: "inbox" }, "a")).toBe(2);
    expect(tripThreads({ type: "trips" }, "b")).toBe(2);
    expect(tripThreads({ type: "trips" }, "c")).toBe(0);
  });

  it("doesn't let another account's trip mail loose outside the trip", () => {
    // Pinned mail surfaces outside its trip in the inbox, so a pinned thread
    // from account b in a shared trip would otherwise leak into a's inbox.
    const flight = msg();
    const hotel = ofB({ pinned: true });
    const memberships = { [flight.headerMessageId]: membership(flight), [hotel.headerMessageId]: membership(hotel) };
    const s = stream([flight, hotel], { type: "inbox" }, {}, false, {}, { [trip.id]: trip }, memberships, "a");

    expect(kinds(s)).toEqual(["trip"]);
  });
});

describe("search view", () => {
  const search = (query: string): StreamView => ({ type: "search", query });

  it("finds matches wherever they are, loose rather than bundled", () => {
    const inbox = msg({ subject: "Dinner Friday", category: "promos" });
    const done = msg({ subject: "Dinner plans", origin: "done", date: NOW - 5 * MINUTE });
    const snoozed = msg({ subject: "Dinner again", snoozed: true, date: NOW - 6 * MINUTE });
    const other = msg({ subject: "Lunch" });

    const s = stream([inbox, done, snoozed, other], search("dinner"));

    expect(kinds(s)).toEqual(["thread", "thread", "thread"]);
    expect(s.threadCount).toBe(3);
  });

  it("shows the whole conversation around a matching message", () => {
    const original = msg({ subject: "Dinner Friday", author: "Bo <bo@example.com>" });
    const reply = msg({
      subject: "Re: Dinner Friday",
      author: "Me <me@example.com>",
      origin: "sent",
      date: NOW,
      inReplyTo: [original.headerMessageId],
    });

    const s = stream([original, reply], search("bo@example"));
    const [item] = items(s);

    expect(item?.type === "thread" && item.thread.messages.length).toBe(2);
  });

  it("includes reminders whose text matches", () => {
    const r: ReminderRecord = { id: "r1", text: "Book the café", createdAt: NOW, status: "active", pinned: false };

    expect(kinds(stream([], search("cafe"), {}, false, { r1: r }))).toEqual(["reminder"]);
    expect(kinds(stream([], search("tea"), {}, false, { r1: r }))).toEqual([]);
  });
});

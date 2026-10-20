import { describe, expect, it } from "vitest";
import type { MessageOrigin, RawMessage } from "./types";
import { buildThreads, normalizeSubject, resolveThread, threadRef } from "./threading";

let nextId = 1;

const msg = (over: Partial<RawMessage> = {}): RawMessage => ({
  key: `k${nextId}`,
  tbId: nextId++,
  headerMessageId: `<m${nextId}@example.com>`,
  subject: "Lunch?",
  author: "Ada <ada@example.com>",
  recipients: ["me@example.com"],
  ccList: [],
  bccList: [],
  date: 1_000,
  size: 100,
  read: false,
  folderId: "inbox",
  accountId: "acct1",
  tags: [],
  category: null,
  pinned: false,
  snoozed: false,
  origin: "inbox" as MessageOrigin,
  ...over,
});

const ME = new Set(["me@example.com"]);

describe("normalizeSubject", () => {
  it.each([
    ["Re: Lunch?", "lunch?"],
    ["RE: FW: Lunch?", "lunch?"],
    ["Fwd: Re: Lunch?", "lunch?"],
    ["  Lunch   today  ", "lunch today"],
    ["Refund request", "refund request"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeSubject(input)).toBe(expected);
  });

  it("does not loop forever on a deeply prefixed subject", () => {
    expect(normalizeSubject("Re: ".repeat(50) + "Lunch?")).toBe("re: ".repeat(42) + "lunch?");
  });
});

describe("buildThreads", () => {
  it("groups a reply with its parent via In-Reply-To", () => {
    const parent = msg({ headerMessageId: "<a@example.com>" });
    const reply = msg({
      headerMessageId: "<b@example.com>",
      inReplyTo: ["<a@example.com>"],
      subject: "Re: Lunch?",
      date: 2_000,
    });

    const threads = buildThreads([parent, reply], ME);

    expect(threads).toHaveLength(1);
    expect(threads[0]!.messages.map((m) => m.key)).toEqual([parent.key, reply.key]);
    expect(threads[0]!.latestDate).toBe(2_000);
  });

  it("follows a References chain across an absent middle message", () => {
    const first = msg({ headerMessageId: "<a@example.com>" });
    const third = msg({
      headerMessageId: "<c@example.com>",
      references: ["<a@example.com>", "<b@example.com>"],
      date: 3_000,
    });

    expect(buildThreads([first, third], ME)).toHaveLength(1);
  });

  it("keeps same-subject mail from different senders apart", () => {
    const fromAda = msg({ headerMessageId: "<a@example.com>" });
    const fromBob = msg({
      headerMessageId: "<b@example.com>",
      author: "Bob <bob@example.com>",
    });

    expect(buildThreads([fromAda, fromBob], ME)).toHaveLength(2);
  });

  it("keeps identical threads in different accounts apart", () => {
    const a = msg({ headerMessageId: "<shared@example.com>", accountId: "acct1" });
    const b = msg({ headerMessageId: "<shared@example.com>", accountId: "acct2" });

    expect(buildThreads([a, b], ME)).toHaveLength(2);
  });

  it("attaches a sent reply to the inbox thread it answers", () => {
    const incoming = msg({ headerMessageId: "<a@example.com>", date: 1_000 });
    const myReply = msg({
      headerMessageId: "<b@example.com>",
      author: "Me <me@example.com>",
      recipients: ["ada@example.com"],
      subject: "Re: Lunch?",
      origin: "sent",
      date: 2_000,
    });

    const threads = buildThreads([incoming, myReply], ME);

    expect(threads).toHaveLength(1);
    expect(threads[0]!.hasMe).toBe(true);
    expect(threads[0]!.participantsLabel).toBe("Ada, me (2)");
  });

  it("shows mail that came back to me once, as the received copy", () => {
    const echo = {
      headerMessageId: "<self@example.com>",
      author: "Me <me@example.com>",
      recipients: ["me-alt@example.com"],
      subject: "Test message",
    };
    const sent = msg({ ...echo, key: "sent-copy", origin: "sent", read: true });
    const received = msg({ ...echo, key: "inbox-copy", date: 1_500 });

    const [thread, ...rest] = buildThreads([sent, received], ME);

    expect(rest).toHaveLength(0);
    expect(thread!.messages.map((m) => m.key)).toEqual(["inbox-copy"]);
    // The Sent view never sees the inbox copy, so it keeps its own.
    expect(buildThreads([sent], ME, new Set(["sent"]))[0]!.messages).toEqual([sent]);
  });

  it("drops threads with no message in an anchor folder", () => {
    const sentOnly = msg({ origin: "sent", author: "Me <me@example.com>" });
    expect(buildThreads([sentOnly], ME)).toHaveLength(0);
    expect(buildThreads([sentOnly], ME, new Set(["sent"]))).toHaveLength(1);
  });

  it("counts unread only for anchor-folder messages", () => {
    const unreadInbox = msg({ headerMessageId: "<a@example.com>", read: false });
    const unreadSent = msg({
      headerMessageId: "<b@example.com>",
      inReplyTo: ["<a@example.com>"],
      origin: "sent",
      read: false,
      author: "Me <me@example.com>",
    });

    expect(buildThreads([unreadInbox, unreadSent], ME)[0]!.unreadCount).toBe(1);
  });

  it("gives a thread a stable id when a newer message arrives", () => {
    const first = msg({ headerMessageId: "<a@example.com>", date: 1_000 });
    const second = msg({
      headerMessageId: "<b@example.com>",
      inReplyTo: ["<a@example.com>"],
      date: 5_000,
    });

    const before = buildThreads([first], ME)[0]!.id;
    const after = buildThreads([first, second], ME)[0]!.id;

    expect(after).toBe(before);
  });

  it("gives a conversation the same id in every view", () => {
    const sent = msg({ headerMessageId: "<a@example.com>", origin: "sent", date: 1_000 });
    const reply = msg({
      headerMessageId: "<b@example.com>",
      inReplyTo: ["<a@example.com>"],
      date: 5_000,
    });

    const inbox = buildThreads([sent, reply], ME, new Set(["inbox"]))[0]!.id;
    const search = buildThreads([sent, reply], ME, new Set(["inbox", "done", "sent", "draft"]))[0]!.id;

    expect(search).toBe(inbox);
  });

  it("sorts a resurfaced thread by its wake time, not its original date", () => {
    const old = msg({ headerMessageId: "<a@example.com>", date: 1_000, resurfacedAt: 9_000 });
    const recent = msg({ headerMessageId: "<b@example.com>", author: "Bob <bob@example.com>", date: 5_000 });

    const threads = buildThreads([old, recent], ME);

    expect(threads[0]!.messages[0]!.key).toBe(old.key);
    expect(threads[0]!.resurfacedAt).toBe(9_000);
  });

  it("abbreviates participants past three senders", () => {
    const senders = ["Ada", "Bob", "Cy", "Dee"].map((name, i) =>
      msg({
        headerMessageId: `<${i}@example.com>`,
        inReplyTo: i === 0 ? undefined : ["<0@example.com>"],
        author: `${name} <${name.toLowerCase()}@example.com>`,
        date: 1_000 + i,
      }),
    );

    expect(buildThreads(senders, ME)[0]!.participantsLabel).toBe("Ada, Bob, +2 (4)");
  });
});

describe("resolveThread", () => {
  it("follows a thread whose id changes once its References are fetched", () => {
    // An archive-imported row is headers only: no References until the
    // conversation is opened and its details are filled in.
    const earlier = msg({ headerMessageId: "<a@example.com>", origin: "done", date: 1_000 });
    const headerOnly = msg({ headerMessageId: "<b@example.com>", origin: "done", date: 5_000 });
    const anchors = new Set<MessageOrigin>(["inbox", "done"]);

    const opened = buildThreads([earlier, headerOnly], ME, anchors).find((t) =>
      t.messages.includes(headerOnly),
    )!;
    const hydrated = { ...headerOnly, references: ["<a@example.com>"] };
    const after = buildThreads([earlier, hydrated], ME, anchors);

    expect(after.some((t) => t.id === opened.id)).toBe(false);
    const found = resolveThread(after, threadRef(opened));
    expect(found?.messages.map((m) => m.key)).toEqual([earlier.key, hydrated.key]);
  });

  it("prefers an exact id over a thread that shares a message", () => {
    const a = msg({ headerMessageId: "<a@example.com>" });
    const b = msg({ headerMessageId: "<b@example.com>", author: "Bob <bob@example.com>" });
    const threads = buildThreads([a, b], ME);
    const target = threads.find((t) => t.messages.includes(b))!;

    expect(resolveThread(threads, { id: target.id, keys: [a.key] })).toBe(target);
  });
});

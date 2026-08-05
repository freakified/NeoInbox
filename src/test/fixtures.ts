/**
 * Declarative mailbox shapes and message builders for the fake messenger.
 *
 * The shapes exist because "works on my inbox" is the failure mode these tests
 * are meant to catch: multiple accounts, a missing Archives folder, folders
 * that only expose the deprecated `type` instead of `specialUse`, and folders
 * big enough to paginate all behave differently in the scan path.
 */
import type { FakeAccountSpec, FakeMessageSpec, FakeMessengerOptions } from "./fakeMessenger";

/**
 * Never import the db singleton here: boot() resets the module registry, so a
 * reference captured at import time would point at a stale Dexie instance.
 * Helpers take the live db from the booted app instead.
 */
type Db = (typeof import("../store/db"))["db"];

let seq = 0;

/** A mailing-list post: `list-post` makes the forums rule match. */
export const forumMail = (over: FakeMessageSpec = {}): FakeMessageSpec => ({
  author: "Dev List <list@googlegroups.com>",
  subject: `Re: patch review ${++seq}`,
  headers: {
    "List-Post": ["<mailto:dev@googlegroups.com>"],
    "List-Id": ["dev.googlegroups.com"],
  },
  ...over,
});

/** A marketing blast: promos needs both `list-unsubscribe` and a promo subject. */
export const promoMail = (over: FakeMessageSpec = {}): FakeMessageSpec => ({
  author: "Shop <deals@shop.example>",
  subject: `50% off everything ${++seq}`,
  headers: { "List-Unsubscribe": ["<https://shop.example/u>"] },
  ...over,
});

/** Plain correspondence: matches no rule, so it stays loose in the inbox. */
export const personalMail = (over: FakeMessageSpec = {}): FakeMessageSpec => ({
  author: "Alex <alex@example.com>",
  subject: `Lunch on Thursday ${++seq}`,
  headers: {},
  ...over,
});

export const INBOX = "inbox-a";
export const ARCHIVE = "archive-a";
export const SENT = "sent-a";
export const DRAFTS = "drafts-a";

const account = (
  id: string,
  prefix: string,
  messages: FakeMessageSpec[],
  opts: { archive?: boolean; legacyType?: boolean } = {},
): FakeAccountSpec => {
  const role = (name: string) =>
    opts.legacyType ? { type: name } : { specialUse: [name] };
  return {
    id,
    identities: [{ email: `${id}@example.com` }],
    folders: [
      { id: `inbox-${prefix}`, name: "Inbox", ...role("inbox"), messages },
      { id: `sent-${prefix}`, name: "Sent", ...role("sent") },
      { id: `drafts-${prefix}`, name: "Drafts", ...role("drafts") },
      ...(opts.archive === false
        ? []
        : [{ id: `archive-${prefix}`, name: "Archives", ...role("archives") }]),
    ],
  };
};

export const shapes = {
  /** One account, inbox + sent + drafts + archives. The happy path. */
  standard: (messages: FakeMessageSpec[] = []): FakeMessengerOptions => ({
    accounts: [account("a", "a", messages)],
  }),

  /** Two accounts, each with its own folder set. */
  multiAccount: (
    a: FakeMessageSpec[] = [],
    b: FakeMessageSpec[] = [],
  ): FakeMessengerOptions => ({
    accounts: [account("a", "a", a), account("b", "b", b)],
  }),

  /** No Archives folder: archiving must fail loudly rather than lose mail. */
  noArchive: (messages: FakeMessageSpec[] = []): FakeMessengerOptions => ({
    accounts: [account("a", "a", messages, { archive: false })],
  }),

  /** Folders exposing only the deprecated `type`, never `specialUse`. */
  legacyFolderRoles: (messages: FakeMessageSpec[] = []): FakeMessengerOptions => ({
    accounts: [account("a", "a", messages, { legacyType: true })],
  }),

  /** Small pages, so folder listing has to walk continueList. */
  paginated: (messages: FakeMessageSpec[], pageSize = 10): FakeMessengerOptions => ({
    accounts: [account("a", "a", messages)],
    pageSize,
  }),
};

/** n messages built by `make`, dated newest-first from `startedAt`. */
export const many = (
  n: number,
  make: (over: FakeMessageSpec) => FakeMessageSpec,
  startedAt = Date.UTC(2026, 6, 1),
): FakeMessageSpec[] =>
  Array.from({ length: n }, (_, i) => make({ date: new Date(startedAt + i * 60_000) }));

/** How many cached inbox rows sit in each category; "none" for unbundled. */
export const categoriesOf = async (db: Db): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {};
  for (const m of await db.messages.toArray()) {
    if (m.origin !== "inbox") continue;
    const key = m.category ?? "none";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

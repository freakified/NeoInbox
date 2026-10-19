import Dexie from "dexie";
import { db } from "./db";
import type { MessageOrigin, RawMessage, TripMembershipRecord } from "../shared/types";

/**
 * What the SPA holds in memory. The inbox (capped by the scan window) and
 * drafts load whole. Sent and Done only grow — every sweep adds to Done — so
 * they load newest-first a page at a time, plus whatever older Done mail a
 * trip still shows. Done, Sent and bundle views page in the rest on request.
 */
export const HISTORY_PAGE = 1500;

export const isHistory = (m: { origin: MessageOrigin }): boolean =>
  m.origin === "sent" || m.origin === "done";

const allOf = (origin: MessageOrigin): Promise<RawMessage[]> =>
  db.messages
    .where("[origin+date]")
    .between([origin, Dexie.minKey], [origin, Dexie.maxKey])
    .toArray();

/** Every cached inbox row, for a reload after the inbox import. */
export const loadInbox = (): Promise<RawMessage[]> => allOf("inbox");

/**
 * The newest page of Sent and of Done dated at or before `before`.
 * `historyFrom` is the date every Sent and Done row from then on is loaded
 * by: the later of the two pages' oldest rows, counting only a page that came
 * back full (a short page reached the end). 0 means nothing older is left.
 * The bound is inclusive, so rows sharing the boundary millisecond are read
 * again rather than skipped; callers merge by id.
 */
export const loadHistoryPage = async (
  before?: number,
): Promise<{ rows: RawMessage[]; historyFrom: number }> => {
  const pages = await Promise.all(
    (["sent", "done"] as const).map((origin) =>
      db.messages
        .where("[origin+date]")
        .between([origin, Dexie.minKey], [origin, before ?? Dexie.maxKey], true, true)
        .reverse()
        .limit(HISTORY_PAGE)
        .toArray(),
    ),
  );
  let historyFrom = 0;
  for (const page of pages) {
    if (page.length === HISTORY_PAGE) historyFrom = Math.max(historyFrom, page.at(-1)!.date);
  }
  return { rows: pages.flat(), historyFrom };
};

/**
 * The cached rows behind these trip memberships, however old: a past trip is
 * all Done mail, and a trip with no loaded mail would not render at all.
 */
export const loadTripMembers = async (
  memberships: readonly TripMembershipRecord[],
): Promise<RawMessage[]> => {
  // Membership keys are pinKeyOf: a Message-ID, or a row key for the odd
  // message without one. Look them up both ways.
  const keys = memberships.filter((m) => m.tripId).map((m) => m.key);
  if (!keys.length) return [];
  const [byHeader, byKey] = await Promise.all([
    db.messages.where("headerMessageId").anyOf(keys).toArray(),
    db.messages.bulkGet(keys),
  ]);
  const rows = new Map<string, RawMessage>();
  for (const m of [...byHeader, ...byKey]) if (m) rows.set(m.key, m);
  return [...rows.values()];
};

/** Everything the SPA starts with: see the comment on HISTORY_PAGE. */
export const loadStartupMessages = async (
  memberships: readonly TripMembershipRecord[],
): Promise<{ rows: RawMessage[]; historyFrom: number }> => {
  const [inbox, drafts, history] = await Promise.all([
    allOf("inbox"),
    allOf("draft"),
    loadHistoryPage(),
  ]);
  const members = history.historyFrom ? await loadTripMembers(memberships) : [];
  return { rows: [...inbox, ...drafts, ...history.rows, ...members], historyFrom: history.historyFrom };
};

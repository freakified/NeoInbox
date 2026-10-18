import { describe, expect, it } from "vitest";
import type { Category, RawMessage, Thread } from "../../shared/types";
import { planBulkMove, rulesForGroup } from "./bulkMove";

const thread = (id: string, author: string, category: Category | null = null): Thread => ({
  id,
  subject: id,
  messages: [{ key: `${id}-m`, author } as RawMessage],
  participantsLabel: "",
  latestDate: 0,
  unreadCount: 0,
  pinned: false,
  category,
  accountId: "a",
  hasMe: false,
});

describe("planBulkMove", () => {
  it("groups organization senders by domain and shared-provider senders by address", () => {
    const plan = planBulkMove(
      [
        thread("a", "Ann <ann@acme.com>"),
        thread("b", "Bob <bob@acme.com>"),
        thread("c", "cat@gmail.com"),
        thread("d", "dan@gmail.com"),
      ],
      "promos",
    );
    expect(plan.groups.map((g) => [g.id, g.emails, g.threads.map((t) => t.id)])).toEqual([
      ["domain:acme.com", ["ann@acme.com", "bob@acme.com"], ["a", "b"]],
      ["email:cat@gmail.com", ["cat@gmail.com"], ["c"]],
      ["email:dan@gmail.com", ["dan@gmail.com"], ["d"]],
    ]);
  });

  it("sets aside threads already in the destination and ones with no sender", () => {
    const plan = planBulkMove(
      [thread("a", "ann@acme.com", "promos"), thread("b", ""), thread("c", "x@y.com", null)],
      "promos",
    );
    expect(plan.alreadyThere.map((t) => t.id)).toEqual(["a"]);
    expect(plan.unroutable.map((t) => t.id)).toEqual(["b"]);
    expect(plan.groups.map((g) => g.id)).toEqual(["domain:y.com"]);
  });

  it("treats uncategorized threads as already in personal", () => {
    const plan = planBulkMove([thread("a", "ann@acme.com", null)], "personal");
    expect(plan.alreadyThere.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("rulesForGroup", () => {
  it("makes one domain rule, or one rule per sender", () => {
    const [group] = planBulkMove(
      [thread("a", "ann@acme.com"), thread("b", "bob@acme.com")],
      "promos",
    ).groups;
    expect(rulesForGroup(group!, "domain")).toEqual([{ type: "domain", value: "acme.com" }]);
    expect(rulesForGroup(group!, "email")).toEqual([
      { type: "email", value: "ann@acme.com" },
      { type: "email", value: "bob@acme.com" },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { boot } from "../../test/boot";
import { shapes } from "../../test/fixtures";

describe("searchInThunderbird", () => {
  it("opens the inbox in a mail tab with the quick filter set", async () => {
    const app = await boot(shapes.standard(), { wireBackground: false });
    const { searchInThunderbird } = await import("./thunderbirdViews");
    await searchInThunderbird("  lisbon  ");
    expect(app.mail.calls.quickFilters).toEqual([
      {
        tabId: 2,
        properties: {
          show: true,
          text: { text: "lisbon", author: true, recipients: true, subject: true },
        },
      },
    ]);
  });

  it("ignores an empty search", async () => {
    const app = await boot(shapes.standard(), { wireBackground: false });
    const { searchInThunderbird } = await import("./thunderbirdViews");
    await searchInThunderbird("   ");
    expect(app.mail.calls.quickFilters).toEqual([]);
  });
});

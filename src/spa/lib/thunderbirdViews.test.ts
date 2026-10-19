import { describe, expect, it } from "vitest";
import { boot } from "../../test/boot";
import { account, shapes } from "../../test/fixtures";

describe("searchInThunderbird", () => {
  it("opens the archive in a mail tab with the quick filter set", async () => {
    const app = await boot(shapes.standard(), { wireBackground: false });
    const { searchInThunderbird } = await import("./thunderbirdViews");
    await searchInThunderbird("  lisbon  ");
    expect(app.mail.calls.quickFilters).toEqual([
      {
        tabId: 2,
        properties: {
          show: true,
          text: { text: "lisbon", author: true, recipients: true, subject: true, body: true },
        },
      },
    ]);
    expect(app.mail.calls.mailTabFolders).toEqual(["archive-a"]);
  });

  it("falls back to the inbox without an archive folder", async () => {
    const app = await boot(
      { accounts: [account("a", "a", [], { archive: false })] },
      { wireBackground: false },
    );
    const { searchInThunderbird } = await import("./thunderbirdViews");
    await searchInThunderbird("lisbon");
    expect(app.mail.calls.mailTabFolders).toEqual(["inbox-a"]);
  });

  it("searches the account being shown before the default one", async () => {
    const app = await boot(
      { accounts: [account("a", "a", []), account("b", "b", [])] },
      { wireBackground: false },
    );
    const { searchInThunderbird } = await import("./thunderbirdViews");
    await searchInThunderbird("lisbon", "b");
    expect(app.mail.calls.mailTabFolders).toEqual(["archive-b"]);
  });

  it("ignores an empty search", async () => {
    const app = await boot(shapes.standard(), { wireBackground: false });
    const { searchInThunderbird } = await import("./thunderbirdViews");
    await searchInThunderbird("   ");
    expect(app.mail.calls.quickFilters).toEqual([]);
  });
});

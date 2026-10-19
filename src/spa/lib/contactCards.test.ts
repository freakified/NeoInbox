import { beforeEach, describe, expect, it, vi } from "vitest";
import { boot } from "../../test/boot";
import type { FakeMessengerOptions } from "../../test/fakeMessenger";

const photo = new Blob(["jpeg"], { type: "image/jpeg" });

const mailbox = (contacts: FakeMessengerOptions["contacts"]): FakeMessengerOptions => ({
  accounts: [
    {
      id: "a",
      identities: [{ email: "Dan@Example.com" }, { email: "alias@example.com" }],
      folders: [{ id: "inbox", specialUse: ["inbox"] }],
    },
  ],
  contacts,
});

describe("contact cards", () => {
  beforeEach(() => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:photo${n++}`);
  });

  it("reads a card's name and photo, matching the address in any case", async () => {
    await boot(mailbox([{ emails: ["Priya@Example.com"], name: "Priya Raman", photo }]), { wireBackground: false });
    const { contactFor } = await import("./contactCards");
    expect(await contactFor("priya@EXAMPLE.com")).toEqual({ name: "Priya Raman", photo: "blob:photo0" });
  });

  it("finds a card by any of its addresses, past the first two", async () => {
    await boot(
      mailbox([{ emails: ["p@one.example", "p@two.example", "p@three.example"], name: "Priya", photo }]),
      { wireBackground: false },
    );
    const { contactFor } = await import("./contactCards");
    expect((await contactFor("p@three.example")).name).toBe("Priya");
  });

  it("doesn't lend your photo to other people", async () => {
    await boot(mailbox([{ emails: ["alias@example.com"], photo }]), { wireBackground: false });
    const { contactFor } = await import("./contactCards");
    expect(await contactFor("stranger@example.com")).toEqual({ name: "", photo: null });
  });

  it("borrows the photo from your card for another of your addresses", async () => {
    await boot(
      mailbox([
        { emails: ["dan@example.com"], name: "Dan" },
        { emails: ["alias@example.com"], name: "Dan T", photo },
      ]),
      { wireBackground: false },
    );
    const { selfProfileFor } = await import("./contactCards");
    expect(await selfProfileFor("dan@example.com")).toEqual({ name: "Dan", photo: "blob:photo0" });
    // Same card, same object URL.
    expect(await selfProfileFor("alias@example.com")).toEqual({ name: "Dan T", photo: "blob:photo0" });
  });

  it("ignores cards that only mention the address in passing", async () => {
    await boot(mailbox([{ emails: ["dan@example.com.au"], name: "Someone else", photo }]), { wireBackground: false });
    const { contactFor } = await import("./contactCards");
    expect(await contactFor("dan@example.com")).toEqual({ name: "", photo: null });
  });
});

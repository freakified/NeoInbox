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

describe("profileFor", () => {
  beforeEach(() => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:photo${n++}`);
  });

  it("reads your card's name and photo, matching the address in any case", async () => {
    await boot(mailbox([{ email: "dan@example.com", name: "Alex Rivera", photo }]), { wireBackground: false });
    const { profileFor } = await import("./selfProfile");
    expect(await profileFor("DAN@example.com")).toEqual({ name: "Alex Rivera", photo: "blob:photo0" });
  });

  it("borrows the photo from your card for another of your addresses", async () => {
    await boot(
      mailbox([
        { email: "dan@example.com", name: "Dan" },
        { email: "alias@example.com", name: "Dan T", photo },
      ]),
      { wireBackground: false },
    );
    const { profileFor } = await import("./selfProfile");
    expect(await profileFor("dan@example.com")).toEqual({ name: "Dan", photo: "blob:photo0" });
    // Same card, same object URL.
    expect(await profileFor("alias@example.com")).toEqual({ name: "Dan T", photo: "blob:photo0" });
  });

  it("ignores cards that only mention the address in passing", async () => {
    await boot(mailbox([{ email: "dan@example.com.au", name: "Someone else", photo }]), { wireBackground: false });
    const { profileFor } = await import("./selfProfile");
    expect(await profileFor("dan@example.com")).toEqual({ name: "", photo: null });
  });
});

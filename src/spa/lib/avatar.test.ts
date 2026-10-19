import { describe, expect, it } from "vitest";
import { threadAvatarAddress } from "./avatar";

const me = new Set(["me@example.com"]);
const msg = (author: string, recipients: string[] = [], ccList: string[] = []) => ({ author, recipients, ccList });

describe("threadAvatarAddress", () => {
  it("skips your own messages for the first other sender", () => {
    expect(
      threadAvatarAddress(
        [msg("Me <ME@example.com>", ["Priya <priya@example.com>"]), msg("Sam <sam@example.com>"), msg("Priya <priya@example.com>")],
        me,
      ),
    ).toBe("Sam <sam@example.com>");
  });

  it("shows who you wrote to when every message is yours", () => {
    expect(
      threadAvatarAddress([msg("me@example.com", ["me@example.com"], ["Lena <lena@example.com>"])], me),
    ).toBe("Lena <lena@example.com>");
  });

  it("falls back to you on a note to yourself", () => {
    expect(threadAvatarAddress([msg("me@example.com", ["me@example.com"])], me)).toBe("me@example.com");
  });
});

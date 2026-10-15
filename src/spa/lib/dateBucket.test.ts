import { describe, expect, it } from "vitest";
import { formatTimeAgo } from "./dateBucket";

const now = Date.UTC(2026, 9, 15, 12);
const ago = (ms: number) => formatTimeAgo(now - ms, now);
const MIN = 60_000;

describe("formatTimeAgo", () => {
  it("uses the coarsest whole unit", () => {
    expect(ago(20_000)).toBe("just now");
    expect(ago(1 * MIN)).toBe("1 minute ago");
    expect(ago(59 * MIN)).toBe("59 minutes ago");
    expect(ago(60 * MIN)).toBe("1 hour ago");
    expect(ago(25 * 60 * MIN)).toBe("1 day ago");
    expect(ago(13 * 24 * 60 * MIN)).toBe("13 days ago");
    expect(ago(21 * 24 * 60 * MIN)).toBe("3 weeks ago");
  });
});

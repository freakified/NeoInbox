import { describe, expect, it } from "vitest";
import { rangesBeyond, sinceOf } from "./archiveRanges";

const NOW = Date.UTC(2026, 9, 18);
const labels = (covered: number | null | undefined) => rangesBeyond(covered, NOW).map((r) => r.label);

describe("rangesBeyond", () => {
  it("offers every range before anything is imported", () => {
    expect(labels(undefined)).toEqual(["Last year", "Last 2 years", "Last 5 years", "Everything"]);
  });

  it("offers nothing once the whole archive is in", () => {
    expect(labels(null)).toEqual([]);
  });

  it("offers only ranges that reach further than the coverage", () => {
    expect(labels(sinceOf(2, NOW))).toEqual(["Last 5 years", "Everything"]);
  });

  it("treats a same-sized range asked a little later as already covered", () => {
    const twoYearsAWeekAgo = sinceOf(2, NOW - 7 * 24 * 60 * 60 * 1000);
    expect(labels(twoYearsAWeekAgo)).toEqual(["Last 5 years", "Everything"]);
  });
});

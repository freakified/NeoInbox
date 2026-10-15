import { describe, expect, it } from "vitest";
import { scoreReservation } from "./scoreReservation";
import type { ReservationSegment } from "../shared/types";

const at = (day: string): number => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!).getTime();
};

const flight = (start: string, origin: string, destination: string): ReservationSegment => ({
  kind: "flight",
  start: at(start),
  origin,
  destination,
});

const none = { segments: [], confirmationCodes: [], cancelled: false };

describe("scoreReservation", () => {
  it("calls a non-reservation with nothing extracted a true negative", () => {
    expect(scoreReservation({ reviewed: true, segments: [], codes: [] }, none).verdict).toBe("tn");
  });

  it("flags segments pulled from a non-reservation as a false positive", () => {
    const s = scoreReservation(
      { reviewed: true, segments: [], codes: [] },
      { ...none, segments: [flight("2026-05-01", "SFO", "NRT")] },
    );
    expect(s.verdict).toBe("fp");
    expect(s.problems[0]).toMatch(/^extra flight 2026-05-01/);
  });

  it("calls a missed reservation a false negative", () => {
    const s = scoreReservation(
      { reviewed: true, segments: [{ kind: "flight", start: "2026-05-01", origin: "SFO", destination: "NRT" }], codes: [] },
      none,
    );
    expect(s.verdict).toBe("fn");
  });

  it("is exact only when every labeled field agrees", () => {
    const want = {
      reviewed: true,
      segments: [
        { kind: "flight" as const, start: "2026-05-01", origin: "SFO", destination: "NRT" },
        { kind: "flight" as const, start: "2026-05-10", origin: "NRT", destination: "SFO" },
      ],
      codes: ["ABC123"],
    };
    const right = scoreReservation(want, {
      segments: [flight("2026-05-10", "NRT", "SFO"), flight("2026-05-01", "SFO", "NRT")],
      confirmationCodes: ["abc123"],
      cancelled: false,
    });
    expect(right.verdict).toBe("exact");
    expect(right.codesTp).toBe(1);

    const swapped = scoreReservation(want, {
      segments: [flight("2026-05-01", "NRT", "SFO"), flight("2026-05-10", "NRT", "SFO")],
      confirmationCodes: ["ABC123", "ZZZ999"],
      cancelled: false,
    });
    expect(swapped.verdict).toBe("partial");
    expect(swapped.matched).toBe(2);
    expect(swapped.exactSegments).toBe(1);
    expect(swapped.codesFp).toBe(1);
  });

  it("doesn't judge fields the label leaves out", () => {
    const s = scoreReservation(
      { reviewed: true, segments: [{ kind: "lodging", start: "2026-05-01" }], codes: [] },
      { ...none, segments: [{ kind: "lodging", start: at("2026-05-01"), end: at("2026-05-03") }] },
    );
    expect(s.verdict).toBe("exact");
  });
});

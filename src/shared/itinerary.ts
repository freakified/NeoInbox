/**
 * A trip's itinerary card: the reservations behind its members, flattened to
 * one line per flight / stay / train, the way Inbox showed them at the top of
 * an open trip ("San Francisco to Newark – AS 1182").
 *
 * Several emails describe the same booking (confirmation, check-in reminder,
 * schedule change), so segments are deduplicated by what they describe, not
 * by which email they came from.
 */
import { cityOfAirport } from "./airports";
import type { ReservationKind, ReservationRecord, ReservationSegment } from "./types";

export interface ItineraryItem {
  id: string;
  kind: ReservationKind;
  title: string;
  /** "Dec 22, 10:10 PM – Dec 23, 6:10 AM"; times only where the email had them. */
  when: string;
  start: number;
}

export const ITINERARY_ICONS: Record<ReservationKind, string> = {
  flight: "flight",
  lodging: "hotel",
  train: "train",
  rental: "directions_car",
  dining: "restaurant",
  event: "event",
  other: "event",
};

const place = (code: string | undefined): string | undefined =>
  code ? cityOfAirport(code) : undefined;

/** "UA 837" out of "UA 837 SFO → NRT"; text parsers sometimes give only that. */
const flightNumberOf = (summary: string | undefined): string | undefined =>
  summary?.match(/^([A-Z0-9]{2}\s?\d{1,4})\b/)?.[1];

const titleOf = (s: ReservationSegment): string => {
  const from = place(s.origin);
  const to = place(s.destination);
  const route = from && to ? `${from} to ${to}` : to ? `To ${to}` : undefined;
  switch (s.kind) {
    case "flight": {
      const number = flightNumberOf(s.summary);
      if (route) return number ? `${route} – ${number}` : route;
      return s.summary || "Flight";
    }
    case "train": {
      // Train summaries are either a bare train number or "N A → B".
      const number = s.summary && !s.summary.includes("→") ? s.summary : undefined;
      if (route) return number ? `${route} – ${number}` : route;
      return s.summary || "Train";
    }
    case "lodging":
      return s.summary || (to ? `Stay in ${to}` : "Hotel stay");
    case "rental":
      return s.summary ? `Car rental – ${s.summary}` : to ? `Car rental in ${to}` : "Car rental";
    default:
      return s.summary || to || "Reservation";
  }
};

/** Text extractors only know the day and store local midnight. */
const hasTime = (ms: number): boolean => {
  const d = new Date(ms);
  return d.getHours() !== 0 || d.getMinutes() !== 0;
};

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const formatWhen = (start: number, end: number | undefined, now = Date.now()): string => {
  const thisYear = new Date(now).getFullYear();
  const day = (d: Date): string =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(d.getFullYear() !== thisYear ? { year: "numeric" } : {}),
    });
  const time = (d: Date): string => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const stamp = (ms: number): string => {
    const d = new Date(ms);
    return hasTime(ms) ? `${day(d)}, ${time(d)}` : day(d);
  };
  if (end === undefined || end === start) return stamp(start);
  const s = new Date(start);
  const e = new Date(end);
  if (sameDay(s, e)) {
    return hasTime(start) && hasTime(end) ? `${stamp(start)} – ${time(e)}` : day(s);
  }
  return `${stamp(start)} – ${stamp(end)}`;
};

const dayKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** What a segment is about, regardless of which email said it. */
const identityOf = (s: ReservationSegment): string =>
  s.kind === "flight" || s.kind === "train"
    ? [s.kind, s.origin, s.destination, dayKey(s.start)].join("|")
    : [s.kind, s.summary ?? s.destination, dayKey(s.start)].join("|");

/** Higher is better: real times beat bare dates, an end beats none. */
const detail = (s: ReservationSegment): number =>
  (hasTime(s.start) ? 2 : 0) + (s.end !== undefined ? 1 : 0) + (s.summary ? 1 : 0);

export const buildItinerary = (
  reservations: readonly ReservationRecord[],
  now = Date.now(),
): ItineraryItem[] => {
  const best = new Map<string, ReservationSegment>();
  const oldestFirst = [...reservations].sort((a, b) => a.messageDate - b.messageDate);
  for (const r of oldestFirst) {
    if (r.status !== "extracted") continue;
    for (const segment of r.segments) {
      const id = identityOf(segment);
      const current = best.get(id);
      // Ties go to the newer email: schedule changes come after the original.
      if (!current || detail(segment) >= detail(current)) best.set(id, segment);
    }
  }
  return [...best.entries()]
    .map(([id, segment]) => ({
      id,
      kind: segment.kind,
      title: titleOf(segment),
      when: formatWhen(segment.start, segment.end, now),
      start: segment.start,
    }))
    .sort((a, b) => a.start - b.start);
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * The trip as an email, for the banner's Forward: Inbox shared a trip as its
 * summary — the itinerary, not the pile of confirmation emails behind it.
 * Confirmation codes stay out: anyone holding one can manage the booking.
 */
export const itineraryMessage = (
  tripName: string,
  dates: string,
  items: readonly ItineraryItem[],
): { subject: string; text: string; html: string } => {
  const lines = items.map((item) => ({ title: item.title, detail: item.when }));
  const text = [
    tripName,
    dates,
    "",
    ...lines.flatMap((l) => [l.title, l.detail, ""]),
  ]
    .join("\n")
    .trim();
  const html = [
    `<p><b>${escapeHtml(tripName)}</b>${dates ? `<br>${escapeHtml(dates)}` : ""}</p>`,
    ...lines.map((l) => `<p>${escapeHtml(l.title)}<br>${escapeHtml(l.detail)}</p>`),
  ].join("");
  return { subject: dates ? `${tripName} (${dates})` : tripName, text, html };
};

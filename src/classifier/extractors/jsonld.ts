/**
 * schema.org JSON-LD tier. Mostly dead among airlines, but Airbnb
 * confirmations, Spirit itineraries, OpenTable and FareHarbor bookings still
 * embed full Reservation nodes — parsing them is free and exact.
 */
import type { ReservationKind, ReservationSegment } from "../../shared/types";
import type { Extraction, Extractor, ExtractorInput } from "./types";

const LD_JSON_RE =
  /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

type Node = Record<string, unknown>;

const flattenLdNodes = (parsed: unknown): Node[] => {
  if (Array.isArray(parsed)) return parsed.flatMap(flattenLdNodes);
  if (parsed && typeof parsed === "object") {
    const node = parsed as Node;
    const graph = node["@graph"];
    if (Array.isArray(graph)) return graph.flatMap(flattenLdNodes);
    return [node];
  }
  return [];
};

const typesOf = (node: Node): string[] => {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
};

const KIND_BY_TYPE: Record<string, ReservationKind> = {
  FlightReservation: "flight",
  LodgingReservation: "lodging",
  TrainReservation: "train",
  BusReservation: "train",
  RentalCarReservation: "rental",
  FoodEstablishmentReservation: "dining",
  EventReservation: "event",
  TaxiReservation: "other",
  Reservation: "other",
  ReservationPackage: "other",
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

const obj = (v: unknown): Node | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Node) : undefined;

/** "2023-07-25T20:00:00-07:00" — the wall-clock part, offset ignored. */
const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;

/**
 * Reservation times mean the venue's wall clock: dinner at 8pm on the 25th
 * is "the 25th" wherever the reader is. Honoring the offset instead shifts
 * evening bookings to the next UTC day, and booking.com's "16:00+00:00"
 * check-ins (really local) onto the wrong day west of Greenwich. Text-tier
 * dates are local midnights, so this keeps both tiers on the same footing.
 */
const time = (v: unknown): number | undefined => {
  const s = str(v);
  if (!s) return undefined;
  const m = s.match(WALL_CLOCK_RE);
  if (m) {
    const [, y, mo, d, h, mi, sec] = m;
    return new Date(
      Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(sec ?? 0),
    ).getTime();
  }
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? undefined : ms;
};

/** name of a place-ish node, or the node itself when it's already a string. */
const placeName = (v: unknown): string | undefined => {
  const s = str(v);
  if (s) return s;
  const node = obj(v);
  if (!node) return undefined;
  return str(node["iataCode"]) ?? str(node["name"]);
};

const localityOf = (v: unknown): string | undefined => {
  const node = obj(v);
  if (!node) return undefined;
  const address = obj(node["address"]);
  return str(address?.["addressLocality"]);
};

const segmentOf = (kind: ReservationKind, node: Node): ReservationSegment | null => {
  const target = obj(node["reservationFor"]) ?? {};
  if (kind === "flight") {
    const start = time(target["departureTime"]);
    if (start === undefined) return null;
    const origin = placeName(target["departureAirport"]);
    const destination = placeName(target["arrivalAirport"]);
    const airline = obj(target["airline"]);
    const flight = [str(airline?.["iataCode"]), str(target["flightNumber"])]
      .filter(Boolean)
      .join(" ");
    return {
      kind,
      start,
      end: time(target["arrivalTime"]),
      origin,
      destination,
      summary: [flight, origin && destination ? `${origin} → ${destination}` : undefined]
        .filter(Boolean)
        .join(" "),
    };
  }
  if (kind === "lodging") {
    const start = time(node["checkinTime"]) ?? time(node["checkinDate"]);
    if (start === undefined) return null;
    const name = placeName(target);
    return {
      kind,
      start,
      end: time(node["checkoutTime"]) ?? time(node["checkoutDate"]),
      // The hotel's name is the summary; as a destination it named trips
      // "Trip to Sakura Hotel Nippori".
      destination: localityOf(target),
      summary: name,
    };
  }
  if (kind === "train") {
    const start = time(target["departureTime"]);
    if (start === undefined) return null;
    return {
      kind,
      start,
      end: time(target["arrivalTime"]),
      origin: placeName(target["departureStation"]),
      destination: placeName(target["arrivalStation"]),
      summary: str(target["trainNumber"]),
    };
  }
  if (kind === "rental") {
    const start = time(node["pickupTime"]);
    if (start === undefined) return null;
    return {
      kind,
      start,
      end: time(node["dropoffTime"]),
      destination: placeName(node["pickupLocation"]),
      summary: placeName(target),
    };
  }
  // dining / event / other: a start time and a venue is all there is.
  const start =
    time(node["startTime"]) ?? time(target["startDate"]) ?? time(target["startTime"]);
  if (start === undefined) return null;
  return {
    kind,
    start,
    destination: localityOf(target) ?? placeName(target["location"]),
    summary: placeName(target),
  };
};

const CANCELLED_RE = /cancell?ed/i;

export const jsonLdExtractor: Extractor = {
  id: "jsonld",
  domains: [],
  extract: (input: ExtractorInput): Extraction | null => {
    const segments: ReservationSegment[] = [];
    const codes = new Set<string>();
    let cancelled = false;
    for (const match of input.html.matchAll(LD_JSON_RE)) {
      if (match[1] === undefined) continue;
      let nodes: Node[];
      try {
        nodes = flattenLdNodes(JSON.parse(match[1]));
      } catch {
        continue;
      }
      for (const node of nodes) {
        for (const t of typesOf(node)) {
          const kind = KIND_BY_TYPE[t];
          if (!kind) continue;
          const segment = segmentOf(kind, node);
          if (segment) segments.push(segment);
          const code = str(node["reservationNumber"]) ?? str(node["reservationId"]);
          if (code) codes.add(code.replace(/^#/, "").toUpperCase());
          if (CANCELLED_RE.test(str(node["reservationStatus"]) ?? "")) cancelled = true;
        }
      }
    }
    if (!segments.length && !codes.size) return null;
    return { segments, confirmationCodes: [...codes], cancelled };
  },
};

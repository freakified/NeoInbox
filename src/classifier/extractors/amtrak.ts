/**
 * Amtrak eTickets: "Reservation Number" + numbered trains + "City, ST"
 * station pairs. Rail-specific because train numbers ("Train 501") and
 * station text don't fit the airline engine's IATA-token model.
 */
import type { ReservationSegment } from "../../shared/types";
import type { Extraction, Extractor } from "./types";
import { CANCEL_RE, dateNear, findConfirmationCodes, findDates } from "./text";

const TRAIN_RE = /\btrain\s*#?\s*(\d{1,4})\b/gi;
/** "Seattle, WA" — city+state as Amtrak prints stations. */
const STATION_RE = /\b([A-Z][a-zA-Z.'-]+(?: [A-Z][a-zA-Z.'-]+){0,3}),\s?([A-Z]{2})\b/g;
const SUBJECT_RE = /\b(reservation|e-?ticket|confirmation|receipt|trip|travel)\b/i;

export const amtrakExtractor: Extractor = {
  id: "amtrak",
  domains: ["amtrak.com"],
  extract: (input): Extraction | null => {
    const codes = findConfirmationCodes(input.text);
    if (!SUBJECT_RE.test(input.subject) && !codes.length) return null;

    const dates = findDates(input.text, input.messageDate);
    if (!dates.length) return null;

    const stations = [...input.text.matchAll(STATION_RE)].map((m) => ({
      value: `${m[1]}, ${m[2]}`,
      index: m.index,
    }));
    const trains = [...input.text.matchAll(TRAIN_RE)].map((m) => ({
      value: `Train ${m[1]}`,
      index: m.index,
    }));
    if (!trains.length && stations.length < 2) return null;

    const segments: ReservationSegment[] = [];
    for (let i = 0; i + 1 < stations.length; i += 2) {
      const origin = stations[i];
      const destination = stations[i + 1];
      if (!origin || !destination || origin.value === destination.value) {
        i -= 1;
        continue;
      }
      const near = dateNear(dates, origin.index);
      if (!near) continue;
      const train = trains.find((t) => Math.abs(t.index - origin.index) < 600);
      segments.push({
        kind: "train",
        start: near.date,
        origin: origin.value,
        destination: destination.value,
        summary: [train?.value, `${origin.value} → ${destination.value}`]
          .filter(Boolean)
          .join(" "),
      });
    }
    if (!segments.length) {
      // Anchor to actual evidence (a train number, else the lone station),
      // not "some date in the document" — see flights.ts for why an
      // unanchored pick chains unrelated emails into one giant trip.
      const anchor = trains[0]?.index ?? stations[0]?.index;
      const near = anchor === undefined ? undefined : dateNear(dates, anchor);
      if (!near) return null;
      segments.push({
        kind: "train",
        start: near.date,
        summary: trains[0]?.value,
      });
    }

    return {
      segments,
      confirmationCodes: codes,
      cancelled: CANCEL_RE.test(input.subject),
    };
  },
};

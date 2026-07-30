import type { ReservationSegment } from "../../shared/types";

export interface ExtractorInput {
  senderEmail: string;
  senderDomain: string;
  subject: string;
  /** Message Date header (ms); infers the year when body dates omit it. */
  messageDate: number;
  /** Plain-text rendering of every text part (HTML stripped, entities decoded). */
  text: string;
  /** Raw HTML parts joined, for extractors that need markup (JSON-LD). */
  html: string;
}

export interface Extraction {
  segments: ReservationSegment[];
  confirmationCodes: string[];
  /** The email announces a cancellation: attach to a trip, never create one. */
  cancelled: boolean;
}

export interface Extractor {
  id: string;
  /** Sender domain suffixes this extractor owns; empty = offered every message. */
  domains: string[];
  extract: (input: ExtractorInput) => Extraction | null;
}

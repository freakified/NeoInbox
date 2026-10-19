import { useEffect, useRef, useState } from "react";
import { log } from "../../shared/log";
import type { Carrier, Parcel, RawMessage, Thread } from "../../shared/types";
import { senderName } from "../lib/avatar";
import { openExternal } from "../lib/external";
import { Icon } from "./Icon";
import { ParcelArt } from "./ParcelArt";
import s from "./ParcelCards.module.css";

const CARRIER_NAMES: Record<Carrier, string> = {
  ups: "UPS",
  usps: "USPS",
  fedex: "FedEx",
  dhl: "DHL",
  ontrac: "OnTrac",
  yamato: "Yamato",
  sagawa: "Sagawa",
  japanpost: "Japan Post",
  amazon: "Amazon",
  yodobashi: "Yodobashi",
  unknown: "Tracking number",
};

const JP_CARRIERS = new Set<Carrier>(["yamato", "sagawa", "japanpost", "yodobashi"]);

/** Japanese slips print their 12 digits as 1234-5678-9012; so do these cards. */
const formatNumber = (p: Parcel & { number: string }): string =>
  JP_CARRIERS.has(p.carrier) && /^\d{12}$/.test(p.number)
    ? p.number.replace(/^(\d{4})(\d{4})/, "$1-$2-")
    : p.number;

/** A parcel with the message it came from, whose sender heads its card. */
export interface ParcelRef {
  parcel: Parcel;
  message: RawMessage;
}

/** A thread's parcels, newest message first, each shipment once. */
export const collectParcels = (messages: readonly RawMessage[]): ParcelRef[] => {
  const seen = new Set<string>();
  const out: ParcelRef[] = [];
  for (const m of [...messages].sort((a, b) => b.date - a.date)) {
    for (const p of m.parcels ?? []) {
      const id = p.number ?? p.url ?? p.carrier;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ parcel: p, message: m });
    }
  }
  return out;
};

/**
 * The parcels a collapsed bundle shows: every one among threads still in the
 * inbox, newest first, as Inbox lined up a bundle's highlights on its row.
 */
export const bundleHighlights = (threads: readonly Thread[]): ParcelRef[] =>
  collectParcels(threads.filter((t) => t.messages.some((m) => m.origin === "inbox")).flatMap((t) => t.messages));

/**
 * Inbox's purchase highlight with TRACK PACKAGE where VIEW ORDER was, minus
 * the shipment state: box art, the shop, carrier and number. A number with
 * nowhere to look it up offers COPY NUMBER instead.
 */
const ParcelCard = ({ parcel: p, message, nth }: ParcelRef & { nth: string }) => {
  const [copied, setCopied] = useState(false);
  const carrier = CARRIER_NAMES[p.carrier];
  const shop = senderName(message.author);
  const detail = p.number
    ? `${p.carrier === "unknown" ? "Tracking" : carrier} ${formatNumber({ ...p, number: p.number })}`
    : `${carrier} package${nth}`;
  const content = (
    <>
      <ParcelArt className={s.art} />
      <span className={s.text}>
        <span className={s.name}>{shop || carrier}</span>
        <span className={s.detail}>{detail}</span>
        <span className={s.action}>{p.url ? "Track package" : copied ? "Copied" : "Copy number"}</span>
      </span>
    </>
  );
  return p.url ? (
    <a
      className={s.card}
      href={p.url}
      target="_blank"
      rel="noopener noreferrer"
      title={p.number ? `Track ${carrier} ${p.number}` : `Track this ${carrier} package`}
      onClick={(e) => {
        e.preventDefault();
        openExternal(p.url!);
      }}
    >
      {content}
    </a>
  ) : (
    <button
      type="button"
      className={s.card}
      title="Copy the tracking number"
      onClick={() => {
        if (!p.number) return;
        navigator.clipboard.writeText(p.number).then(
          () => setCopied(true),
          (e: unknown) => log.warn("parcels", "copying the tracking number failed", e),
        );
      }}
    >
      {content}
    </button>
  );
};

/** One card's width plus the gap, as laid out in ParcelCards.module.css. */
const CARD_STEP = 380 + 8;

/**
 * The cards in a row, side by side and scrolling sideways when they overflow,
 * like Inbox's bundle highlights. Arrows appear on whichever side has more,
 * for anyone without a sideways-scrolling trackpad.
 */
export const ParcelCards = ({ parcels }: { parcels: readonly ParcelRef[] }) => {
  const strip = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const update = () =>
      setMore({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      resize.disconnect();
    };
  }, [parcels.length]);

  const page = (direction: 1 | -1) => {
    const el = strip.current;
    if (!el) return;
    // Whole cards at a time, at least one.
    const step = Math.max(1, Math.floor(el.clientWidth / CARD_STEP)) * CARD_STEP;
    el.scrollBy({ left: direction * step, behavior: "smooth" });
  };

  return (
    // The row opens on click; the cards and arrows are controls of their own.
    <div className={s.frame} onClick={(e) => e.stopPropagation()}>
      <div ref={strip} className={s.strip}>
        {parcels.map((ref, i) => {
          // Several link-only parcels from one mail read "Amazon package 1", "… 2".
          const unnumbered = parcels.filter(
            (q) => q.message === ref.message && !q.parcel.number && q.parcel.carrier === ref.parcel.carrier,
          );
          const nth = unnumbered.length > 1 ? ` ${unnumbered.indexOf(ref) + 1}` : "";
          return <ParcelCard key={`${ref.parcel.number ?? ref.parcel.url ?? ref.parcel.carrier}:${i}`} {...ref} nth={nth} />;
        })}
      </div>
      {more.left && (
        <button type="button" className={`${s.arrow} ${s.arrowLeft}`} title="Previous packages" onClick={() => page(-1)}>
          <Icon name="chevron_left" />
        </button>
      )}
      {more.right && (
        <button type="button" className={`${s.arrow} ${s.arrowRight}`} title="More packages" onClick={() => page(1)}>
          <Icon name="chevron_right" />
        </button>
      )}
    </div>
  );
};

import { useState } from "react";
import { log } from "../../shared/log";
import type { Carrier, Parcel, RawMessage } from "../../shared/types";
import { Icon } from "./Icon";
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

/**
 * Hands a carrier page to the system browser. A plain link would load inside
 * Thunderbird's tab, if at all.
 */
const openExternal = (url: string): void => {
  messenger.windows.openDefaultBrowser(url).catch((e: unknown) => {
    log.warn("parcels", "opening the tracking page failed", e);
  });
};

/** A thread's parcels, newest message first, each shipment once. */
export const collectParcels = (messages: readonly RawMessage[]): Parcel[] => {
  const seen = new Set<string>();
  const out: Parcel[] = [];
  for (const m of [...messages].sort((a, b) => b.date - a.date)) {
    for (const p of m.parcels ?? []) {
      const id = p.number ?? p.url ?? p.carrier;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(p);
    }
  }
  return out;
};

/**
 * Inbox's package cards, minus the shipment state: who carries it, the
 * tracking number, and TRACK to the carrier's page. A number with nowhere to
 * look it up offers COPY instead.
 */
export const ParcelCards = ({ parcels, limit = 2 }: { parcels: readonly Parcel[]; limit?: number }) => {
  const [copied, setCopied] = useState<string | null>(null);
  const visible = parcels.slice(0, limit);
  const overflow = parcels.length - visible.length;
  return (
    // The row opens on click; the cards are links of their own.
    <div className={s.strip} onClick={(e) => e.stopPropagation()}>
      {visible.map((p, i) => {
        const name = CARRIER_NAMES[p.carrier];
        // Several link-only parcels from one mail read "Amazon package 1", "… 2".
        const unnumbered = parcels.filter((q) => !q.number && q.carrier === p.carrier);
        const nth = unnumbered.length > 1 ? ` ${unnumbered.indexOf(p) + 1}` : "";
        // Link-only parcels (Amazon) have no number: one line, "Amazon package".
        const title = p.number || p.carrier === "unknown" ? name : `${name} package${nth}`;
        const body = (
          <>
            <Icon name="package_2" className={s.icon} />
            <span className={s.meta}>
              <span className={p.number ? s.carrier : s.number}>{title}</span>
              {p.number && <span className={s.number}>{formatNumber({ ...p, number: p.number })}</span>}
            </span>
            <span className={s.action}>{p.url ? "Track" : copied === p.number ? "Copied" : "Copy"}</span>
          </>
        );
        const key = `${p.number ?? p.url ?? p.carrier}:${i}`;
        return p.url ? (
          <a
            key={key}
            className={s.card}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              openExternal(p.url!);
            }}
            title={p.number ? `Track ${name} ${p.number}` : `Track this ${name} package`}
          >
            {body}
          </a>
        ) : (
          <button
            key={key}
            type="button"
            className={s.card}
            title="Copy the tracking number"
            onClick={() => {
              if (!p.number) return;
              navigator.clipboard.writeText(p.number).then(
                () => setCopied(p.number!),
                (e: unknown) => log.warn("parcels", "copying the tracking number failed", e),
              );
            }}
          >
            {body}
          </button>
        );
      })}
      {overflow > 0 && <span className={s.overflow}>+{overflow}</span>}
    </div>
  );
};

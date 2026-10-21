/**
 * HTML building blocks for the demo's automated mail, so each sender looks
 * like the real thing: a branded header, tables of items, buttons, and the
 * small grey footer every company sends. Everything is inline-styled, since
 * that is all mail clients honour, and every image is an inline SVG data URI,
 * so it renders with remote images blocked.
 */

export interface Brand {
  name: string;
  /** The header band and button colour. */
  color: string;
  /** Inner SVG for a 40×40 logo mark, drawn in white on the brand colour. */
  mark: string;
  /** Postal address for the footer, if any. Invented, like everything else here. */
  address?: string;
  font?: string;
  /** The page behind the email. */
  page?: string;
}

const SANS = "Helvetica, Arial, sans-serif";

/** An SVG image as an <img> source. */
export const svgSrc = (viewBox: string, inner: string): string =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${inner}</svg>`)}`;

export const img = (src: string, width: number, height: number, style = ""): string =>
  `<img src="${src}" width="${width}" height="${height}" alt="" style="display: block; border: 0; ${style}">`;

export interface EmailParts {
  /** The inbox preview line, hidden in the body as real senders do. */
  preheader?: string;
  body: string;
  /** Why you got this, at the top of the footer. */
  reason?: string;
  unsubscribe?: boolean;
}

/** The whole message: page, branded header, white content card, footer. */
export const email = (brand: Brand, { preheader, body, reason, unsubscribe }: EmailParts): string => {
  const font = brand.font ?? SANS;
  const links = [unsubscribe && "Unsubscribe", "Email preferences", "Privacy policy", "Help"]
    .filter(Boolean)
    .map((l) => `<a href="https://example.com/${String(l).toLowerCase().replace(/\s+/g, "-")}" style="color: #777">${l}</a>`)
    .join(" &nbsp;·&nbsp; ");
  return (
    `<html><body style="margin: 0; padding: 24px 12px; background: ${brand.page ?? "#eef0f3"}; font-family: ${font}; color: #222">` +
    (preheader ? `<div style="display: none; max-height: 0; overflow: hidden">${preheader}</div>` : "") +
    `<div style="max-width: 560px; margin: 0 auto">` +
    `<div style="background: ${brand.color}; border-radius: 10px 10px 0 0; padding: 16px 24px">` +
    `<table role="presentation" style="border-collapse: collapse"><tr>` +
    `<td style="padding: 0 12px 0 0">${img(svgSrc("0 0 40 40", brand.mark), 36, 36)}</td>` +
    `<td style="color: #fff; font-size: 19px; font-weight: bold; letter-spacing: 0.3px">${brand.name}</td>` +
    `</tr></table></div>` +
    `<div style="background: #fff; padding: 28px 28px 32px; border-radius: 0 0 10px 10px; line-height: 1.5; font-size: 15px">${body}</div>` +
    `<div style="padding: 20px 16px; text-align: center; font-family: ${SANS}; font-size: 12px; line-height: 1.6; color: #888">` +
    (reason ? `<p style="margin: 0 0 8px">${reason}</p>` : "") +
    `<p style="margin: 0 0 8px">${links}</p>` +
    `<p style="margin: 0">© ${new Date().getFullYear()} ${brand.name}${brand.address ? ` · ${brand.address}` : ""}</p>` +
    `</div></div></body></html>`
  );
};

export const heading = (text: string, size = 24): string =>
  `<h1 style="margin: 0 0 12px; font-size: ${size}px; line-height: 1.25; color: #111">${text}</h1>`;

export const para = (text: string, style = ""): string => `<p style="margin: 0 0 14px; ${style}">${text}</p>`;

export const small = (text: string): string => `<p style="margin: 16px 0 0; font-size: 13px; color: #777">${text}</p>`;

export const button = (label: string, color: string): string =>
  `<p style="margin: 22px 0"><a href="https://example.com/" style="display: inline-block; background: ${color}; color: #fff; ` +
  `text-decoration: none; font-weight: bold; padding: 12px 26px; border-radius: 6px">${label}</a></p>`;

export const divider = (): string => `<hr style="border: 0; border-top: 1px solid #e6e6e6; margin: 22px 0">`;

/** Label/value pairs in two columns, for booking references and the like. */
export const details = (rows: [string, string][]): string =>
  `<table role="presentation" style="width: 100%; border-collapse: collapse; margin: 8px 0 4px; font-size: 14px">` +
  rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding: 7px 0; color: #777; width: 42%; border-bottom: 1px solid #f0f0f0">${k}</td>` +
        `<td style="padding: 7px 0; font-weight: bold; border-bottom: 1px solid #f0f0f0">${v}</td></tr>`,
    )
    .join("") +
  `</table>`;

export interface LineItem {
  thumb: string;
  name: string;
  detail: string;
  price: string;
}

/** An order summary: thumbnails, names, prices, then totals. */
export const items = (lines: LineItem[], totals: [string, string][]): string =>
  `<table role="presentation" style="width: 100%; border-collapse: collapse; font-size: 14px">` +
  lines
    .map(
      (l) =>
        `<tr><td style="padding: 10px 14px 10px 0; width: 64px; border-bottom: 1px solid #f0f0f0">${img(l.thumb, 64, 64, "border-radius: 6px")}</td>` +
        `<td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0"><b>${l.name}</b><br><span style="color: #777">${l.detail}</span></td>` +
        `<td style="padding: 10px 0; text-align: right; white-space: nowrap; border-bottom: 1px solid #f0f0f0">${l.price}</td></tr>`,
    )
    .join("") +
  totals
    .map(
      ([k, v], i) =>
        `<tr><td></td><td style="padding: ${i ? 4 : 12}px 0 0; text-align: right; color: ${i === totals.length - 1 ? "#111" : "#777"}; ` +
        `${i === totals.length - 1 ? "font-weight: bold" : ""}">${k}</td>` +
        `<td style="padding: ${i ? 4 : 12}px 0 0 16px; text-align: right; white-space: nowrap; ${i === totals.length - 1 ? "font-weight: bold" : ""}">${v}</td></tr>`,
    )
    .join("") +
  `</table>`;

/** Ordered → Shipped → … with everything up to `current` filled in. */
export const progress = (steps: string[], current: number, color: string): string =>
  `<table role="presentation" style="width: 100%; border-collapse: collapse; margin: 18px 0 22px; font-size: 12px; text-align: center; table-layout: fixed">` +
  `<tr>${steps
    .map((_, i) => {
      const on = i <= current;
      return (
        `<td style="padding: 0; width: ${100 / steps.length}%">` +
        `<div style="height: 6px; background: ${on ? color : "#e3e3e3"}; border-radius: 3px; margin: 0 2px"></div></td>`
      );
    })
    .join("")}</tr>` +
  `<tr>${steps
    .map((s, i) => `<td style="padding: 8px 2px 0; color: ${i <= current ? "#222" : "#999"}; ${i === current ? "font-weight: bold" : ""}">${s}</td>`)
    .join("")}</tr></table>`;

export interface Leg {
  label: string;
  from: string;
  fromCity: string;
  to: string;
  toCity: string;
  departs: string;
  arrives: string;
  note: string;
}

/** One journey as a boarding-pass-ish block: big codes, times beneath. */
export const leg = (l: Leg, color: string): string =>
  `<div style="border: 1px solid #e3e3e3; border-left: 4px solid ${color}; border-radius: 0 8px 8px 0; padding: 14px 18px; margin: 0 0 12px">` +
  `<div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #777; margin-bottom: 6px">${l.label}</div>` +
  `<table role="presentation" style="width: 100%; border-collapse: collapse"><tr>` +
  `<td style="width: 40%"><div style="font-size: 26px; font-weight: bold; color: #111">${l.from}</div>` +
  `<div style="font-size: 13px; color: #555">${l.fromCity}</div><div style="font-size: 14px; margin-top: 4px"><b>${l.departs}</b></div></td>` +
  `<td style="text-align: center; color: ${color}; font-size: 22px">→</td>` +
  `<td style="width: 40%; text-align: right"><div style="font-size: 26px; font-weight: bold; color: #111">${l.to}</div>` +
  `<div style="font-size: 13px; color: #555">${l.toCity}</div><div style="font-size: 14px; margin-top: 4px"><b>${l.arrives}</b></div></td>` +
  `</tr></table>` +
  `<div style="font-size: 13px; color: #777; margin-top: 8px; border-top: 1px dashed #ddd; padding-top: 8px">${l.note}</div></div>`;

/** A big number with a caption, for amounts due and the like. */
export const figure = (label: string, value: string, caption: string, color = "#111"): string =>
  `<div style="background: #f6f7f9; border-radius: 8px; padding: 18px 20px; margin: 4px 0 8px">` +
  `<div style="font-size: 13px; color: #777">${label}</div>` +
  `<div style="font-size: 34px; font-weight: bold; color: ${color}; line-height: 1.2">${value}</div>` +
  `<div style="font-size: 13px; color: #555">${caption}</div></div>`;

/** A full-width banner image with copy laid over the bottom of it. */
export const hero = (art: string, headline: string, sub: string, ink = "#fff"): string =>
  `<div style="margin: -28px -28px 24px; position: relative">${img(art, 560, 240, "width: 100%; height: auto")}` +
  `<div style="position: absolute; left: 28px; bottom: 22px; color: ${ink}">` +
  `<div style="font-size: 30px; font-weight: bold; line-height: 1.1">${headline}</div>` +
  `<div style="font-size: 15px; margin-top: 6px">${sub}</div></div></div>`;

export interface Product {
  thumb: string;
  name: string;
  price: string;
  was?: string;
}

/** Products two to a row. */
export const productGrid = (products: Product[]): string => {
  const rows: Product[][] = [];
  for (let i = 0; i < products.length; i += 2) rows.push(products.slice(i, i + 2));
  return (
    `<table role="presentation" style="width: 100%; border-collapse: collapse; font-size: 14px">` +
    rows
      .map(
        (row) =>
          `<tr>${row
            .map(
              (p) =>
                `<td style="width: 50%; padding: 8px; vertical-align: top">${img(p.thumb, 236, 200, "width: 100%; height: auto; border-radius: 8px")}` +
                `<div style="margin-top: 8px; font-weight: bold">${p.name}</div>` +
                `<div>${p.was ? `<s style="color: #999">${p.was}</s> ` : ""}<span style="color: #c62828; font-weight: bold">${p.price}</span></div></td>`,
            )
            .join("")}</tr>`,
      )
      .join("") +
    `</table>`
  );
};

/** A dashed box holding a discount code. */
export const code = (label: string, value: string, color: string): string =>
  `<div style="border: 2px dashed ${color}; border-radius: 8px; padding: 12px; text-align: center; margin: 18px 0">` +
  `<div style="font-size: 12px; color: #777; text-transform: uppercase; letter-spacing: 1px">${label}</div>` +
  `<div style="font-size: 22px; font-weight: bold; letter-spacing: 3px; color: ${color}">${value}</div></div>`;

export interface Post {
  name: string;
  color: string;
  text: string;
  meta: string;
}

/** A social digest: an initial in a circle, who, what, when. */
export const posts = (entries: Post[]): string =>
  entries
    .map(
      (e) =>
        `<table role="presentation" style="width: 100%; border-collapse: collapse; margin: 0 0 4px"><tr>` +
        `<td style="width: 44px; vertical-align: top; padding: 10px 12px 10px 0">` +
        `<div style="width: 40px; height: 40px; border-radius: 20px; background: ${e.color}; color: #fff; font-weight: bold; ` +
        `font-size: 17px; line-height: 40px; text-align: center">${e.name[0]}</div></td>` +
        `<td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px"><b>${e.name}</b>` +
        `<div style="margin: 2px 0 4px">${e.text}</div><div style="font-size: 12px; color: #999">${e.meta}</div></td>` +
        `</tr></table>`,
    )
    .join("");

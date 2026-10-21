#!/usr/bin/env node
/**
 * Screenshots the demo mailbox for the landing page: the whole app for the
 * demo window on phones, and a crop per feature card. Writes 2x WebP files to
 * site/public/shots/, so rerun it after UI changes and commit the results.
 *
 *   pnpm site-shots
 *
 * Like shot.mjs, reuses a harness on :5199 or starts its own, and drives the
 * installed Google Chrome. Needs cwebp (brew install webp).
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const PORT = 5199;
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "site/public/shots");
// The landing page's demo window: .live's max width less its padding, by the
// iframe's height (landing.css).
const VIEWPORT = { width: 1132, height: 720 };
// Feature card crops share one shape so the cards line up. The inbox's
// center column, expanded bundles included, is 700px wide.
const CROP = { width: 700, height: 438 };
const COLUMN_X = 344;

const harnessUp = async () => {
  try {
    return (await fetch(`http://localhost:${PORT}/dev.html`)).ok;
  } catch {
    return false;
  }
};

let server = null;
if (!(await harnessUp())) {
  const { createServer } = await import("vite");
  server = await createServer({
    root: ROOT,
    logLevel: "error",
    server: { port: PORT, strictPort: true },
  });
  await server.listen();
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const tmp = await mkdtemp(join(tmpdir(), "neoinbox-shots-"));
await mkdir(OUT, { recursive: true });

// Each shot gets a fresh demo mailbox, so one shot's clicks never leak into
// the next.
const open = async () => {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto(`http://localhost:${PORT}/dev.html?demo`);
  await page.waitForFunction(() => window.neo?.store().hydrated, null, { timeout: 15_000 });
  await page.waitForTimeout(2_500);
  return page;
};

const settle = (page) => page.waitForTimeout(800);

// The column crop starting a little above an element.
const below = async (page, selector) => {
  const box = await page.locator(selector).first().boundingBox();
  return { x: COLUMN_X, y: Math.max(0, Math.round(box.y) - 16), ...CROP };
};

const save = async (page, name, clip) => {
  const png = join(tmp, `${name}.png`);
  await page.screenshot({ path: png, clip });
  execFileSync("cwebp", ["-quiet", "-q", "85", png, "-o", resolve(OUT, `${name}.webp`)]);
  console.log(`[shot] site/public/shots/${name}.webp`);
  await page.close();
};

const shots = {
  // The whole app, standing in for the live demo on phones.
  demo: async (page) => {
    await save(page, "demo");
  },

  stream: async (page) => {
    await save(page, "stream", { x: COLUMN_X, y: 72, ...CROP });
  },

  bundles: async (page) => {
    await page.click("text=Purchases >> nth=1");
    await page.mouse.move(0, VIEWPORT.height - 1);
    await settle(page);
    await save(page, "bundles", await below(page, "text=Purchases >> nth=1"));
  },

  trips: async (page) => {
    await page.click("text=Trip to Los Angeles >> nth=0");
    await page.mouse.move(0, VIEWPORT.height - 1);
    await settle(page);
    await save(page, "trips", await below(page, "text=This week"));
  },

  snooze: async (page) => {
    await page.hover("text=Re: Hiking next week?");
    await page.getByTitle("Snooze").nth(1).click();
    await settle(page);
    await save(page, "snooze", { x: COLUMN_X, y: 180, ...CROP });
  },

  reminders: async (page) => {
    await page.hover("[aria-label='Compose']");
    await page.waitForTimeout(500);
    await page.getByTitle("Reminder").last().click();
    await settle(page);
    await page.keyboard.type("Call the dentist about Friday");
    await page.mouse.move(0, VIEWPORT.height - 1);
    await settle(page);
    await save(page, "reminders", { x: 150, y: 56, width: 830, height: 519 });
  },

  accounts: async (page) => {
    await page.click("[aria-label*='ccount']");
    await settle(page);
    // From the column's left edge, so no row is cut off mid-word.
    await save(page, "accounts", { x: 368, y: 0, width: 764, height: 478 });
  },
};

try {
  for (const shoot of Object.values(shots)) await shoot(await open());
} finally {
  await browser.close();
  await server?.close();
  await rm(tmp, { recursive: true, force: true });
}

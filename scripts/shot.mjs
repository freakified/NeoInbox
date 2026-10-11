#!/usr/bin/env node
/**
 * Screenshots the dev harness in headless Chrome, for checking UI changes
 * without loading the extension into Thunderbird.
 *
 *   pnpm shot                                     # seed inbox -> shots/inbox.png
 *   pnpm shot --click "text=Promos" --shot promos
 *   pnpm shot --eval "neo.deliver('promo')" --wait 500 --shot after-delivery
 *   pnpm shot --width 420 --height 860 --shot narrow
 *
 * Steps run in the order given. --click takes any Playwright selector
 * ("text=Promos", "[aria-label=Done]", "css=.foo"), --eval runs JS in the page
 * and awaits it (window.neo is the harness API, see src/dev/harness.ts),
 * --shot <name> saves shots/<name>.png. With no --shot a final one is taken.
 *
 * Reuses a harness already running on :5199 (pnpm harness), otherwise starts
 * its own Vite server for the run. Uses the installed Google Chrome, so no
 * browser download is needed. Page errors and console warnings are printed,
 * and the exit code is 1 if the page threw.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const PORT = 5199;
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "shots");

const args = process.argv.slice(2);
let width = 1280;
let height = 900;
const steps = [];
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  const value = args[++i];
  if (value === undefined) throw new Error(`${flag} needs a value`);
  if (flag === "--width") width = Number(value);
  else if (flag === "--height") height = Number(value);
  else if (["--click", "--eval", "--wait", "--shot", "--type", "--press"].includes(flag))
    steps.push([flag.slice(2), value]);
  else throw new Error(`unknown flag ${flag}`);
}
if (!steps.some(([kind]) => kind === "shot")) steps.push(["shot", "inbox"]);

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
let pageThrew = false;
try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => {
    pageThrew = true;
    console.log(`[pageerror] ${e.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") console.log(`[${msg.type()}] ${msg.text()}`);
  });

  await page.goto(`http://localhost:${PORT}/dev.html`);
  // The backfill and trip clustering run right after load; let them land so
  // the first shot shows bundles and trips, not a half-scanned inbox.
  await page.waitForFunction(() => window.neo?.store().hydrated, null, { timeout: 15_000 });
  await page.waitForTimeout(2_500);

  await mkdir(OUT, { recursive: true });
  for (const [kind, value] of steps) {
    if (kind === "click") await page.click(value);
    else if (kind === "type") await page.keyboard.type(value);
    else if (kind === "press") await page.keyboard.press(value);
    else if (kind === "wait") await page.waitForTimeout(Number(value));
    else if (kind === "eval") {
      const result = await page.evaluate(`(async () => (${value}))()`);
      if (result !== undefined) console.log(`[eval] ${JSON.stringify(result)}`);
    } else if (kind === "shot") {
      await page.waitForTimeout(400); // let framer-motion transitions finish
      const file = resolve(OUT, `${value}.png`);
      await page.screenshot({ path: file });
      console.log(`[shot] ${file}`);
    }
  }
} finally {
  await browser.close();
  await server?.close();
}
process.exit(pageThrew ? 1 : 0);

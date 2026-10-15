#!/usr/bin/env node
// Prints a sample's HTML as layout lines (htmlToLines), with table ids, plus
// its label — for writing and debugging table-aware extractors.
//   node scripts/labels/lines.mjs <name|path> [--grep=re] [--max=N]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { htmlToLines } from "../../src/classifier/extractors/layout.ts";

globalThis.DOMParser = new JSDOM("").window.DOMParser;
const root = "fixtures/real-mail/trips";
const args = process.argv.slice(2);
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const max = Number(opt("max") ?? 150);
const grep = opt("grep") ? new RegExp(opt("grep"), "i") : null;

const find = (name) => {
  if (existsSync(name)) return name;
  // Exact name, or any unique prefix of one ("2022-06-22-32dd").
  for (const d of readdirSync(root)) {
    const hit = readdirSync(join(root, d)).find(
      (f) => f.startsWith(name) && f.endsWith(".json") && !f.endsWith(".expect.json"),
    );
    if (hit) return join(root, d, hit);
  }
  throw new Error(`no sample ${name}`);
};

for (const name of args.filter((a) => !a.startsWith("--"))) {
  const path = find(name);
  const s = JSON.parse(readFileSync(path, "utf8"));
  const ex = path.replace(/\.json$/, ".expect.json");
  const label = existsSync(ex) ? JSON.parse(readFileSync(ex, "utf8")).reservation : null;
  console.log(`=== ${path}\nSUBJ ${s.subject}\nDATE ${new Date(s.date).toISOString()}`);
  if (label) console.log(`LABEL ${JSON.stringify({ segs: label.segments, codes: label.codes, c: label.cancelled })}`);
  const lines = htmlToLines(s.htmlParts.join("\n"));
  if (!lines.length) console.log("(no html; text)\n" + s.textParts.join("\n").slice(0, 3000));
  let n = 0;
  for (const l of lines) {
    if (grep && !grep.test(l.text)) continue;
    if (n++ >= max) break;
    console.log(`t${String(l.table).padEnd(3)} ${l.text.slice(0, 220)}`);
  }
}

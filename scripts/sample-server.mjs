#!/usr/bin/env node
/**
 * Receiver for neoSampleDump(): writes POSTed MailSamples to
 * fixtures/real-mail/<set>/<sender-domain>/<yyyy-mm-dd>-<hash>.json.
 * Listens on 127.0.0.1 only — the payloads are your real mail.
 *
 *   pnpm samples:receive
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../fixtures/real-mail");
const PORT = 5198;
const MAX_BODY = 32 * 1024 * 1024;

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9.-]+/g, "_").replace(/^\.+/, "") || "unknown";

const day = (ms) => {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const reply = (res, status, body) => {
  res.writeHead(status, { ...cors, "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

let count = 0;

createServer((req, res) => {
  if (req.method === "OPTIONS") return reply(res, 204, {});
  if (req.method === "GET" && req.url === "/ping") return reply(res, 200, { ok: true });
  if (req.method !== "POST" || req.url !== "/sample") return reply(res, 404, { error: "not found" });

  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) req.destroy();
    else chunks.push(chunk);
  });
  req.on("end", () => {
    let sample;
    try {
      sample = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return reply(res, 400, { error: "bad json" });
    }
    if (typeof sample?.key !== "string" || typeof sample.date !== "number") {
      return reply(res, 400, { error: "not a MailSample" });
    }
    const hash = createHash("sha1").update(sample.key).digest("hex").slice(0, 10);
    const file = join(ROOT, slug(sample.set), slug(sample.senderDomain), `${day(sample.date)}-${hash}.json`);
    const created = !existsSync(file);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(sample, null, 2) + "\n");
    count++;
    console.log(`${created ? "new " : "upd "} ${relative(ROOT, file)}  ${sample.subject ?? ""}`.slice(0, 160));
    reply(res, 200, { file: relative(ROOT, file), created });
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`sample receiver on http://127.0.0.1:${PORT} → ${ROOT}`);
  console.log("run `await neoSampleDump()` in the Thunderbird background console");
});

process.on("SIGINT", () => {
  console.log(`\n${count} samples received`);
  process.exit(0);
});

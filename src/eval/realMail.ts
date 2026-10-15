/**
 * Node-side access to the captured real-mail samples (fixtures/real-mail/,
 * gitignored) for the *.eval.ts suites. See src/classifier/samples.ts for
 * the file formats and `neoSampleDump()` for how samples get there.
 */
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ExpectFile, MailSample } from "../classifier/samples";

export const SAMPLES_ROOT = resolve(import.meta.dirname, "../../fixtures/real-mail");
const REPORTS_DIR = join(SAMPLES_ROOT, "_reports");

export interface LoadedSample {
  /** Path relative to SAMPLES_ROOT — the sample's name in reports. */
  name: string;
  sample: MailSample;
  expectPath: string;
  expect: ExpectFile | null;
}

const walk = (dir: string, out: string[]): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith(".json") && !entry.name.endsWith(".expect.json")) out.push(path);
  }
  return out;
};

export const hasSamples = (): boolean => existsSync(SAMPLES_ROOT);

export const loadSamples = (set?: string): LoadedSample[] => {
  const root = set ? join(SAMPLES_ROOT, set) : SAMPLES_ROOT;
  if (!existsSync(root)) return [];
  return walk(root, [])
    .sort()
    .map((path) => {
      const expectPath = path.replace(/\.json$/, ".expect.json");
      return {
        name: relative(SAMPLES_ROOT, path),
        sample: JSON.parse(readFileSync(path, "utf8")) as MailSample,
        expectPath,
        expect: existsSync(expectPath)
          ? (JSON.parse(readFileSync(expectPath, "utf8")) as ExpectFile)
          : null,
      };
    });
};

export const writeExpect = (path: string, expect: ExpectFile): void => {
  writeFileSync(path, JSON.stringify(expect, null, 2) + "\n");
};

/**
 * Saves this run's report as _reports/<name>.json and hands back the previous
 * one (rotated to <name>.prev.json), so a run can say what it changed.
 */
export const rotateReport = <T>(name: string, report: T): T | null => {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const current = join(REPORTS_DIR, `${name}.json`);
  let previous: T | null = null;
  if (existsSync(current)) {
    previous = JSON.parse(readFileSync(current, "utf8")) as T;
    renameSync(current, join(REPORTS_DIR, `${name}.prev.json`));
  }
  writeFileSync(current, JSON.stringify(report, null, 2) + "\n");
  return previous;
};

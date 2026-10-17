/**
 * `pnpm eval`: detector suites scored against your real mail in
 * fixtures/real-mail/ (see src/eval/). Kept out of `pnpm test` because the
 * samples are local-only and the output is a report, not a pass/fail gate.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.eval.ts"],
    setupFiles: ["src/test/setup.ts"],
    // The default reporter hides console output from passing tests.
    reporters: ["verbose"],
    // Scoring 1,000+ real samples runs well past the 5s default.
    testTimeout: 120_000,
  },
});

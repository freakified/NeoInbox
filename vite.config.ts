/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Writes dist/manifest.json from src/manifest.json, stamped with the version
 * in package.json so the two can't drift.
 */
const manifest = (): Plugin => {
  const template = resolve(import.meta.dirname, "src/manifest.json");
  return {
    name: "neoinbox-manifest",
    buildStart() {
      this.addWatchFile(template);
    },
    generateBundle() {
      const { version } = JSON.parse(
        readFileSync(resolve(import.meta.dirname, "package.json"), "utf8"),
      ) as { version: string };
      const fields = JSON.parse(readFileSync(template, "utf8")) as Record<string, unknown>;
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: `${JSON.stringify({ ...fields, version }, null, 2)}\n`,
      });
    },
  };
};

/**
 * `--mode site` builds the public website instead of the extension: the
 * landing page and the live demo (the dev harness on the demo mailbox), as
 * static files for Cloudflare Pages in dist-site/.
 */
const site = defineConfig({
  plugins: [react()],
  root: resolve(import.meta.dirname, "site"),
  base: "/",
  // Only the icon (a symlink to public/icon.svg).
  publicDir: resolve(import.meta.dirname, "site/public"),
  build: {
    outDir: resolve(import.meta.dirname, "dist-site"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "site/index.html"),
        demo: resolve(import.meta.dirname, "site/demo.html"),
      },
    },
  },
  // site/demo.ts imports its code from src/, outside the site root.
  server: { fs: { allow: [import.meta.dirname] } },
});

const extension = defineConfig({
  plugins: [react(), manifest()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "firefox128",
    rollupOptions: {
      input: {
        inbox: resolve(import.meta.dirname, "inbox.html"),
        background: resolve(import.meta.dirname, "src/background/index.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background"
            ? "background.js"
            : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  publicDir: "public",
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});

export default defineConfig(({ mode }) => (mode === "site" ? site : extension));

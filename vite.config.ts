/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * `--mode site` builds the public website instead of the extension: the
 * landing page and the live demo (the dev harness on the demo mailbox), as
 * static files for Cloudflare Pages in dist-site/.
 */
const site = defineConfig({
  plugins: [react()],
  root: resolve(import.meta.dirname, "site"),
  base: "/",
  // Only the icon (a symlink to public/icon.svg); the extension's public/
  // would also ship its manifest.
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
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "firefox115",
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

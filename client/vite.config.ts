import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

// The Node server (server workspace) handles /api/* and /ws and applies the
// cross-origin isolation headers itself. In dev we proxy everything there.
const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:8080";

// Commit SHA shown in the UI footer. CI/Docker pass GIT_SHA as a build arg;
// local builds fall back to reading the working tree.
function resolveAppVersion(): string {
  const fromEnv = process.env.GIT_SHA?.trim();
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}
const APP_VERSION = resolveAppVersion();

const COOP_COEP_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Robots-Tag": "noindex",
};

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    // COOP/COEP on Vite's HTML/JS responses. /api and /ws are proxied to the
    // Node server which sets these headers itself.
    headers: COOP_COEP_HEADERS,
    proxy: {
      "/api": {
        target: SERVER_URL,
        changeOrigin: true,
      },
      "/ws": {
        target: SERVER_URL.replace(/^http/, "ws"),
        ws: true,
      },
    },
  },
  preview: {
    headers: COOP_COEP_HEADERS,
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});

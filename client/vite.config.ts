import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

// Serverless build: there is no Node server. The app is a fully static bundle
// hosted on GitHub Pages. Cross-origin isolation in PRODUCTION is provided by
// the coi-serviceworker COOP/COEP shim (public/coi-serviceworker.js); in DEV we
// set the headers directly here so `crossOriginIsolated === true` without the
// SW reload dance.
//
// `base` must match the GitHub Pages path. Project pages serve under
// `https://<user>.github.io/<repo>/`, so the deploy workflow sets
// VITE_BASE=/<repo>/. Locally it defaults to "/". All runtime-computed URLs use
// `import.meta.env.BASE_URL` so they resolve correctly under any base.
const BASE = process.env.VITE_BASE ?? "/";

// Commit SHA shown in the UI footer. CI passes GIT_SHA; local builds read git.
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

// COEP `credentialless` (not require-corp) so Firebase RTDB's cross-origin
// traffic isn't blocked, while still getting cross-origin isolation +
// SharedArrayBuffer. Matches the production coi-serviceworker config. See
// DECISIONS D15.
const COOP_COEP_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "X-Robots-Tag": "noindex",
};

export default defineConfig({
  base: BASE,
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    headers: COOP_COEP_HEADERS,
  },
  preview: {
    port: 4173,
    headers: COOP_COEP_HEADERS,
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});

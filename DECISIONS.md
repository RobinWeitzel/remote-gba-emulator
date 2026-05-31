# DECISIONS — Serverless re-platforming

Choices made autonomously where the spec left them open, with rationale. Newest first.

## D1 — Hash-based routing instead of pathname routing
The existing router (`client/src/lib/router.ts`) uses `history.pushState` with real pathnames (`/s/<id>`). On GitHub Pages **project pages** the site lives under a subpath (`/<repo>/`) and a hard refresh on a deep path 404s unless an SPA `404.html` fallback is shipped. Switching to **hash routing** (`#/...`) sidesteps both the subpath-deep-link 404 and keeps invite URLs copy-pasteable on any static host. This touches routing only (not sync/emulator), so it respects the "don't rewrite sync internals" constraint.
→ Convert `router.ts` to read/write `location.hash`; invite links become `…/#/join?…`.

## D2 — Configurable Vite `base` for project-page subpath
GitHub Pages serves project sites at `https://<user>.github.io/<repo>/`. Vite `base` is set from `VITE_BASE` (default `/`), and the deploy workflow sets it to `/play-together-gba/`. All runtime-computed URLs (mGBA loader, SW registration, config fetch) use `import.meta.env.BASE_URL` rather than absolute `/…` paths.

## D3 — Firebase web config supplied at runtime via `firebase-config.json`
The Firebase web config is not a secret (§4) but it is per-user. Rather than bake it into the bundle at build time (forcing a rebuild to deploy), the app fetches a same-origin `firebase-config.json` at startup. The user copies `firebase-config.example.json` → `firebase-config.json` with their project values. If missing/placeholder, the app shows setup guidance instead of crashing. Same-origin fetch is COEP-safe.

## D8 — RTDB transaction update fns must handle the optimistic stale-null run
RTDB `runTransaction` invokes the update function optimistically against the local cache FIRST (often `null` for a node this client never read), and a returned `undefined` aborts **finally** — no server re-run. A naive `holder === uid ? null : undefined` release therefore aborts on the stale null and never releases the lock. Pattern adopted: for release, treat `null`-or-own-uid as "write null" so RTDB re-runs against the real server value and commits; only a lock genuinely held by someone else is left untouched. Claim stays `null → uid, else abort` (correct: claim must only win when truly free). Verified by the onDisconnect drop integration test.

## D9 — `firebase-config.json` is git-ignored; example committed
Real per-user config (`client/public/firebase-config.json`) is git-ignored; `firebase-config.example.json` is committed with placeholders. Not secret, but avoids one user's project pointer landing in the repo. The app shows friendly setup guidance (`MissingConfigError`) when it's still the placeholder.

## D5 — COEP `require-corp` first, auto-degrade to `credentialless`
SPEC §9 mandates COEP `require-corp`. Verified research (firebase-js-sdk #6467; web.dev COOP/COEP) notes the one Firebase breakage under require-corp is `signInWithPopup` — moot here, we use `signInAnonymously` (no popup). RTDB uses WebSocket (not COEP-gated) + CORS fetches (COEP-permitted), so require-corp should be fine. The vendored coi-serviceworker is configured `coepCredentialless: () => false` (require-corp) with `coepDegrade: () => true`, so if require-corp ever fails to isolate it automatically retries as `credentialless` — isolation is never silently lost. If M1 Firebase testing reveals a require-corp problem, flip the one line to credentialless.

## D6 — M0 verified on desktop Chromium under exact GitHub Pages conditions
Verified `crossOriginIsolated === true`, `SharedArrayBuffer` available, and the **threaded** mGBA core booting a locally-uploaded ROM (frame counter climbing) when served by `scripts/ghpages-sim.mjs` — a static server that sets **no** COOP/COEP headers, serves under the `/play-together-gba/` subpath, and uses `application/wasm` MIME (i.e. mimics GitHub Pages). Isolation came **solely from the coi-serviceworker shim**, proving the shim path works. The diagnostic lives at `#/m0`. Real-Android verification still needs the human (QUESTIONS.md Q1) but the shim path is identical, so confidence is high. No single-threaded fallback needed.

## D7 — Enabled GitHub Pages via API with build_type=workflow
`actions/configure-pages` cannot auto-enable Pages with the default `GITHUB_TOKEN` (research §5). Instead enabled it once via `gh api -X POST repos/.../pages -f build_type=workflow` using the owner's `repo`-scoped token. The account serves Pages under a custom domain (`robinweitzel.de`), so the deployed URL is `https://robinweitzel.de/play-together-gba/` — the `/play-together-gba/` base path is unchanged. Secure-context/HTTPS must be on for the SW (flagged in QUESTIONS if not).

## D4 — Keep the `shared` workspace types; retire the Node server at runtime
The `shared` protocol types (GbaButton, DEFAULTS, SPEED_LADDER, snapshot/input/speed message shapes) are reused unchanged as the adapter's payload shapes (§3 "keep message shapes identical"). The Node `server` workspace is no longer run in the serverless build but is left in-tree (it still lives on `server-version`); the serverless build only ships the `client`.

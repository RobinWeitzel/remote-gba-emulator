# DECISIONS — Serverless re-platforming

Choices made autonomously where the spec left them open, with rationale. Newest first.

## D1 — Hash-based routing instead of pathname routing
The existing router (`client/src/lib/router.ts`) uses `history.pushState` with real pathnames (`/s/<id>`). On GitHub Pages **project pages** the site lives under a subpath (`/<repo>/`) and a hard refresh on a deep path 404s unless an SPA `404.html` fallback is shipped. Switching to **hash routing** (`#/...`) sidesteps both the subpath-deep-link 404 and keeps invite URLs copy-pasteable on any static host. This touches routing only (not sync/emulator), so it respects the "don't rewrite sync internals" constraint.
→ Convert `router.ts` to read/write `location.hash`; invite links become `…/#/join?…`.

## D2 — Configurable Vite `base` for project-page subpath
GitHub Pages serves project sites at `https://<user>.github.io/<repo>/`. Vite `base` is set from `VITE_BASE` (default `/`), and the deploy workflow sets it to `/play-together-gba/`. All runtime-computed URLs (mGBA loader, SW registration, config fetch) use `import.meta.env.BASE_URL` rather than absolute `/…` paths.

## D3 — Firebase web config supplied at runtime via `firebase-config.json`
The Firebase web config is not a secret (§4) but it is per-user. Rather than bake it into the bundle at build time (forcing a rebuild to deploy), the app fetches a same-origin `firebase-config.json` at startup. The user copies `firebase-config.example.json` → `firebase-config.json` with their project values. If missing/placeholder, the app shows setup guidance instead of crashing. Same-origin fetch is COEP-safe.

## D14 — Session deletion: multi-path null + owner admin-override (subtree delete doesn't bypass child rules)
A single `remove(sessions/$s)` is rejected: RTDB evaluates the descendant `.write` rules on a subtree delete (cascade does NOT bypass them — verified in the emulator: even a permissive `$s` rule didn't authorize the subtree delete). So `deleteSession` writes an explicit multi-path null update (`{meta:null, invites:null, members:null, controllerLock:null, sync:null, saves:null}`), and the owner is given an **admin override** (`isOwner`) on the subtrees whose normal rules would block a null write (controllerLock/holder, sync/*, meta/speedMultiplier, invites delete). This is safe: the override is gated on `meta/owners/<uid>` and is per-session, so it only empowers an owner within their own session; the 11 adversarial tests confirm non-owners remain fully blocked. (Also: reading the bare `sessions/$s` node has no `.read` rule by design — verify deletion via the auth-readable `meta` child.)

## D12 — Handoff = release + next-in-queue auto-claim (rules can't set holder to another uid)
The rules only let a member set `controllerLock/holder` to their OWN uid or null (anti-steal). So control can't be pushed to someone else directly. Handoff is therefore: the holder releases (or drops → onDisconnect nulls holder), and members auto-claim the now-free lock in **queue order** with a jittered backoff (`rank*250ms`), the transaction guaranteeing a single winner. Directed handover puts the target at the front of the queue, then releases, so the target's auto-claim fires first. This covers graceful handoff, directed handover, and ungraceful-drop handoff with one mechanism.

## D13 — Browser E2E used a real browser owner + a Node "device" (Playwright MCP shares one context)
The Playwright MCP drives a single browser context (one IndexedDB → one anonymous UID), so two truly-distinct in-browser devices isn't possible there. Two-device behaviour is proven by the Node integration tests (distinct adapters = distinct UIDs: 20 itests across transport/rules/sync/handoff/drop) and by a live mixed E2E — a real browser owner created the session and minted an invite; a separate Node device redeemed it and joined; the browser owner's roster live-updated to 2 and showed the guest "away" on disconnect.

## D10 — onDisconnect controller-release must be armed only while holding the lock
Security rules validate an `onDisconnect` write **at registration time** against the then-current data (confirmed in the emulator). The drop-release `onDisconnect(controllerLock/holder).set(null)` is only accepted when `holder === auth.uid` at registration. So it is armed right after a successful `claimControl` / at `createSession` (when we hold it) and **cancelled on release/leave** — not pre-armed in `setPresence` (where a non-holder member would be rejected, silently leaving the lock un-released on a drop). This also prevents a stale onDisconnect from nulling a lock we've since handed off. Matters in production, not just the emulator.

## D11 — Rules-as-the-fence, adversarially emulator-tested
`database.rules.json` is default-deny (`.read/.write: false` at root) with explicit per-path grants (§6). Verified by 11 adversarial tests (`firebaseRules.itest.ts`): non-owner can't mint; invite single-use at the rules level; can't redeem to another uid; can't become a member without a redeemed invite; non-member can't read members/sync/saves/controllerLock or write; non-controller member can't write inputs/speed/snapshot/speedMultiplier; can claim a free lock but can't steal or null a held one; only owner can revoke; non-owner can't overwrite meta. RTDB rules have no functions, so helper predicates (isMember/isOwner/isController) are inlined via `root.child(...)`. Session creation is two ordered writes so `root`-based owner checks see committed `meta/owners` (DECISIONS-adjacent: adapter createSession).

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

# PROGRESS — Serverless re-platforming

Branch: `serverless`. The pre-existing server-based app is preserved on `server-version` (pushed to origin).

Tracking: this file (status), `DECISIONS.md` (choices + rationale), `QUESTIONS.md` (blockers for the human).

## Status legend
- ⬜ not started · 🟦 in progress · ✅ done · ⚠️ done-with-caveat (see notes) · 🛑 blocked (see QUESTIONS.md)

## Milestones (§14)

### M0 — Cross-origin isolation on a static host (make-or-break) — ⚠️ (LIVE-verified on deploy; Android pending human)
**Live deploy: https://robinweitzel.de/play-together-gba/ — verified on the real URL: crossOriginIsolated=true, SAB available, threaded mGBA boots a locally-uploaded ROM, 0 console errors.**
Get vendored mGBA (threaded build) running under cross-origin isolation from a static host via a service-worker COOP/COEP shim. Verify `crossOriginIsolated === true`, `SharedArrayBuffer` defined, emulator boots a locally-loaded ROM.
- [x] Static Vite build with correct base path for project-page subpath (`VITE_BASE`, hash routing, `BASE_URL` for runtime URLs)
- [x] coi-serviceworker COOP/COEP shim vendored + wired in index.html (require-corp, auto-degrade)
- [x] GitHub Pages deploy via Actions workflow (`.github/workflows/pages.yml`); Pages enabled via API (build_type=workflow)
- [x] **Verified COI + SAB + threaded mGBA boots a locally-uploaded ROM** on a GitHub-Pages-equivalent host (no COOP/COEP headers, `/play-together-gba/` subpath) via Playwright/Chromium — isolation came solely from the SW shim. `#/m0` diagnostic route.
- [ ] **Real Android device verification — REQUIRES THE HUMAN** (QUESTIONS.md Q1; shim path is identical to the desktop-verified one)
- [ ] Confirm the *live* deployed URL (custom domain `robinweitzel.de`) serves over HTTPS so the SW registers (verify post-deploy)

### M1 — Backend adapter + Firebase RTDB transport — ✅ (emulator-verified)
- [x] `net/adapter.ts` — transport-agnostic §3 interface + types (relay payloads keep existing shapes + `by`)
- [x] `net/firebaseAdapter.ts` — Firebase RTDB implementation (anon sign-in w/ IndexedDB persistence, create/join/reconnect/leave, mintInvite, atomic single-use redeem via transaction, roster, presence + onDisconnect, controllerLock transactions, sync relay, durable saves)
- [x] `net/config.ts` + `firebase-config.example.json` — runtime config load (DECISIONS D3)
- [x] Firebase Emulator wiring: `firebase.json`, `.firebaserc` (demo-gba), `database.rules.json` (open for M1), `npm run itest`
- [x] **5/5 integration tests pass** (`firebaseAdapter.itest.ts`): create→owner is member+controller; second device redeems invite & joins; roster syncs to both; double-redeem rejected; reconnect needs no fresh invite; **ungraceful drop via onDisconnect clears presence + releases control**.
- Fixed an RTDB transaction stale-null abort pitfall in releaseControl/leave (DECISIONS D8).
- firebase SDK not yet in the shipped bundle (nothing imports it until M3 wiring) — by design.
### M2 — Capability model + security rules — ✅ (adversarially emulator-tested)
- [x] `database.rules.json` — default-deny + §6 capability model (owner / single-use invite / member / controller), helpers inlined
- [x] Owner creation, owner-only mintInvite, atomic single-use joinViaInvite (transaction), member-credential persistence, reconnect-without-invite (M1 adapter; rules enforce)
- [x] **11/11 adversarial rules tests pass** (`firebaseRules.itest.ts`): non-owner can't mint; invite single-use at rules level; can't redeem to another uid; can't become member without a redeemed invite; non-member can't read/write; non-controller can't write inputs/speed/snapshot/speedMultiplier; claim-free-yes / steal-or-null-held-no; owner-only revoke; non-owner can't overwrite meta.
- [x] Fixed onDisconnect-controller-release to arm only while holding the lock (DECISIONS D10) — a real production correctness fix.
- [ ] Surface the signed-in user's own UID in-app for owner recovery (§7) — adapter exposes `currentMemberId()`; UI surfacing lands with the new UI in M3/M5.
### M3 — Wire sync/speed/handoff onto RTDB — ✅ (itests + live browser+device E2E)
- [x] SessionPage re-platformed onto the adapter (transport swapped; sync internals — snapshot loop, reconciliation, re-anchor, frame-tagged speed — preserved unchanged)
- [x] New serverless lobby (HomePage): start game (pick local ROM → createSession, become owner), rejoin my sessions, open invite link, surface own UID
- [x] JoinPage (#/join): atomic invite redemption → membership → forward to session (idempotent re-click)
- [x] InGameSheet: mint single-use invite (owner) + copy link, take-control when free, directed handover, own-UID owner-recovery row
- [x] Controller lock + handoff: claim/release transactions; next-in-queue auto-claim on free lock (jittered by queue order); drop handoff via onDisconnect; directed handover via queue-front+release
- [x] Stores: `romStore` (IndexedDB), `sessionStore` (my sessions), `backend` (adapter singleton + runtime config)
- [x] `firebaseSync.itest.ts` (4 tests): inputs/speed/snapshot fan out with author tag, snapshot overwrites latest, speed mirrors to meta, graceful handoff re-points publisher
- [x] **Live browser E2E vs emulator**: owner creates session under locked rules, mGBA runs under COI, owner is controller, mints single-use invite; a distinct device (Node) redeems it & joins; owner's UI live-updates to Players(2); presence shows the guest "away" on disconnect.
- 46 tests total green (26 unit + 20 integration).
### M4 — Local ROM loading + hash gate — ⬜
### M5 — Persistence, guardrails, PWA, deploy, README — ✅
- [x] Durable saves: controller writes `saves/latest` every ~30s; bootstrap from it on cold rejoin when the live snapshot was pruned
- [x] Guardrails (§12): prune `sync/inputs`+`sync/speed` after each snapshot; latest snapshot only (overwrite); owner "End game & delete" teardown (multi-path null + owner admin-override rule, DECISIONS D14)
- [x] PWA: app-shell cache layered into the single coi-serviceworker (network-first + cache fallback) — re-verified COI still true with caching on; manifest base-safe; installable
- [x] Deploy: Pages workflow writes `firebase-config.json` from the `FIREBASE_CONFIG` repo variable; Pages enabled (Actions source)
- [x] README rewritten for serverless: Firebase setup wizard, deploy steps, owner-recovery procedure, free-tier notes, local dev
- [x] `firebaseGuardrails.itest.ts` (3 tests): durable save round-trip, prune clears relay, owner-only session delete
- 49 tests total green (26 unit + 23 integration).
### M6 — Optional hardening (App Check, 2nd adapter) — ⬜ (not started until M0–M5 solid)

## Notes / log
- (init) Read SPEC-SERVERLESS.md fully. Surveyed existing app: Vite + React client, Node WS server, shared protocol types. Sync heart = `client/src/ui/SessionPage.tsx`; transport = `client/src/net/ws.ts`; protocol = `shared/src/index.ts`. mGBA is a **threaded** build (pthreads/SharedArrayBuffer) → COI genuinely required.
- (init) Dispatched background research agent to verify Firebase Spark limits, modular SDK API, RTDB rules syntax, coi-serviceworker status, and GitHub Pages Actions deploy (per spec §0.4 "verify external facts at build time").

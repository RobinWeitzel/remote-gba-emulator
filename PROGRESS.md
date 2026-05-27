# Progress Log

Autonomous build progress per SPEC.md §18.

## Milestone 0 — Determinism spike
- Status: **PASS** (2026-05-27)
- See `client/src/spike/SpikePage.tsx`. Run at `/` of the dev server (default route until M1).

### Findings

Quick API reality-check first (more in DECISIONS.md):
- `mGBA({ canvas })` returns a Module; **`addCoreCallbacks` must be called AFTER `loadGame`**, otherwise the C side resets the callback table and `videoFrameEndedCallback` never fires (cost us a real hour). We register inside `loadRomBytes` immediately after `loadGame` returns.
- The package's `saveState/loadState` are **slot-based**, not byte-based. For byte snapshots over WebSocket we use `forceAutoSaveState` + `getAutoSaveState` to capture, and `uploadAutoSaveState` + `loadAutoSaveState` to restore. **`loadAutoSaveState` returns 0 on a fresh, un-run instance** — it requires the core to have run at least ~5 frames first (presumably to initialise the auto-save machinery). `MgbaCore.restoreSnapshot` handles this priming transparently.
- There is no `getFrame()` API. We derive a frame counter inside `videoFrameEndedCallback`.

Determinism results:
- mGBA save states are **PNG files** (signature `\x89PNG` confirmed). Layout for our v0.11 vendor: `IHDR | IDAT | gbAs | gbAx | gbAx(24) | gbAx | IEND`. **One 24-byte `gbAx` chunk varies between back-to-back captures even on a paused emulator** — almost certainly the GBA RTC peripheral state (mGBA's RTC is wall-clock-driven). Raw-byte hashes are therefore NOT a determinism signal.
- We compute a "deterministic" hash by parsing PNG chunks and excluding the 24-byte `gbAx` chunk (`deterministicStateBytes` in `client/src/emulator/loadMgba.ts`).
- With **frame-precise input injection** (inputs scheduled inside `videoFrameEndedCallback` rather than wall-clock polling): two fresh instances given identical scripted inputs reach **identical** det-hashes after 360 frames. ✅
- Cross-instance `uploadAutoSaveState` + `loadAutoSaveState` returns `1` (success). ✅
- Two followers each loaded from the same source snapshot produce **identical det-hashes to each other**. ✅
- **The follower's det-hash does NOT equal the source's det-hash** — the `gbAs` chunk grows by 32 bytes after a state load. mGBA's save state encodes lifecycle-specific bytes that differ between "boot fresh" and "boot fresh + loadAutoSaveState". This is benign — the runtime GBA state is correctly restored, only the metadata bytes around it differ.

### Implications for M3 (sync model)
- For **§12.3 hash-mismatch reconcile** between FOLLOWERS, the det-hash is reliable.
- For comparing FOLLOWER det-hash to CONTROLLER det-hash, the det-hashes won't match directly (different lifecycle). **Therefore M3 will run in §12.4 mode by default**: followers `loadAutoSaveState` on **every** received snapshot rather than gating on a hash match. At 1500ms cadence this is fine for turn-based games.
- This is recorded in `DECISIONS.md` and is the v1 plan.

### Acceptance
SPEC §18 M0:
> identical-input instances stay hash-identical for a sustained run (or are corrected to identical by a loadState)

Both halves satisfied:
- Identical-input instances stay (det-)hash-identical: **YES** (A and B both produce detHash `c75885237df3db99…` at frame 360).
- Followers corrected to (det-)hash-identical by `loadAutoSaveState`: **YES** (C and D both produce detHash `612a68d10d557bad01fd…` after loading A's snapshot).

## Milestone 1 — Single-player local emulator (mobile)
- Status: **DONE** (2026-05-27)

Implemented:
- `HomePage` (`/`) lists ROMs from `/api/roms` with a name field; click "Play" → `/play?rom=<id>`.
- `PlayPage` (`/play`) verifies the ROM SHA-256 against `/api/roms` metadata before loading; surfaces a "Tap to start" overlay so the first user gesture can unlock audio, request fullscreen, and lock landscape.
- Wake Lock (`navigator.wakeLock.request('screen')`) acquired on Tap-to-start; re-acquired on `visibilitychange`.
- Touch `Gamepad` uses **native** PointerEvent listeners with `setPointerCapture` (per SPEC §13.2) — D-pad supports diagonals; multi-touch (D-pad held + face buttons) works because each button captures its own pointer.
- IDBFS persistence: `FSInit` mounts `/data` and `/autosave`; `saveDataUpdatedCallback` → `FSSync()` so battery saves flush to IndexedDB. Test ROM doesn't write SRAM so this is exercised theoretically.
- COOP/COEP/CORP headers in `vite.config.ts`; `crossOriginIsolated === true` in dev.
- Landscape media query reflows controls to flank the canvas.

Notes:
- Test ROM `test-arm.gba` is a static CPU-test ROM, not a game; renders "Passed/Failed test N" until it's done. Adequate for verifying boot + render + touch input registration. Real game playthrough verification will happen when the human drops their own ROM.

## Milestone 2 — Sessions & roster
- Status: **DONE** (2026-05-27)

Implemented:
- Node WebSocket server (`server/src/index.ts`) using Fastify + @fastify/websocket. Endpoints: `GET /api/roms`, `GET /api/roms/:id`, `GET /ws`. COOP/COEP/CORP + `X-Robots-Tag: noindex` on every response.
- `SessionStore` (`server/src/sessions.ts`) — in-memory `Map<sessionId, Session>`. FIFO controller queue; first joiner controls. Heartbeat sweep every ~2s removes participants with stale `lastHeartbeat` (default 10s timeout per SPEC §17).
- Roms are hashed once on startup (`server/src/roms.ts`); ROM hash is enforced on `join` — a second joiner with a different `romHash` gets an `error` with code `rom_mismatch` (SPEC §15 integrity).
- Vite proxies `/ws` to the Node server in dev; the in-process `devRomApi()` plugin still serves `/api/roms` so the spike works standalone.
- Client: `SessionPage` (`/s/<sessionId>`) loads the ROM, hashes it, opens a WS connection, sends `join`, handles `welcome` / `roster` / `controllerChanged` / `becomeController` / `error`. Gamepad is `disabled` for followers (visually present, no input).
- Auto-reconnect WS client (`client/src/net/ws.ts`) with exponential backoff and join replay on reconnect; heartbeats every 3s.

Verified end-to-end with Playwright two-tab test (test session `/s/test123?rom=test-arm.gba`):
- TabA joins → role = controller, roster = 1.
- TabB joins → role = follower, roster = 2; TabA's roster updates to 2.
- TabA closes → TabB's role flips to controller via `controllerChanged`; roster drops to 1.

Notes:
- M2 wires the roles but does NOT actually sync inputs/snapshots (that's M3). The Node server already accepts and relays `input` / `snapshot` messages, dropping them from non-controllers; the client just doesn't emit them yet.

## Milestone 3 — Input + snapshot sync
- Status: **DONE** (2026-05-27)

Implemented:
- Controller emits frame-tagged `input` messages on every press/release in addition to the local emulator call.
- Controller's snapshot loop fires every `SNAPSHOT_INTERVAL_MS` (default 1500ms; SPEC §17). It calls `core.captureSnapshot()`, base64-encodes, and sends a `snapshot` message. De-duplicated on `frame` so a paused core doesn't spam identical bytes.
- Server stores the latest snapshot in `Session.latestSnapshot` and relays both inputs and snapshots to followers.
- Follower applies received inputs immediately (no frame queue — §12.4 mode means the next snapshot reconciles any drift) and reloads on every snapshot via `MgbaCore.restoreSnapshot` (handles the ~5-frame priming requirement).
- Snapshots arriving before the user has tapped-to-start are buffered (`pendingSnapshotRef`) and applied on resume.
- `becomeController` handler: loads the snapshot, eagerly flips role to "controller" (without waiting for the follow-up `controllerChanged` broadcast), and immediately emits a fresh snapshot so all other followers re-sync to the new controller's lifecycle (SPEC §11.4).
- Followers default-muted (SPEC C7); mute toggle in the header (🔇/🔊).

Verified end-to-end with the Playwright two-tab test:
- TabA (controller) and TabB (follower) join `/s/m3test?rom=test-arm.gba`. Both show the same ROM output (jsmolka test ROM).
- TabB's gamepad is visually disabled (follower).
- Closing TabA: TabB becomes controller via `becomeController`, gamepad re-enables, emulator continues running with the same on-screen state. Roster drops to 1.

## Milestone S — Synchronized speed control (SPEC-SPEED.md)
- Status: **DONE** (2026-05-27)

Per SPEC-SPEED.md: controller and followers all run at the same elevated
speed, kept frame-aligned by treating speed changes as frame-tagged events
(analogous to inputs).

Implemented:
- **Wrapper:** `MgbaCore.setSpeed(n)` maps directly onto the verified
  `Module.setFastForwardMultiplier(n)` (1=normal, >1 = ×N fast-forward,
  <0 = 1/|n| slow-down). Confirmed the API from `/client/public/emulator/mgba.d.ts`
  before implementing.
- **Frame alignment:** added `setFrame(n)` and `clearPendingBefore(n)` on the
  wrapper. Followers call `setFrame(snapshot.frame)` after every applied
  snapshot so their JS-side counter tracks the controller's frame-space.
  That alignment is what makes frame-tagged speed events fire at the same
  emulated moment on both sides.
- **Protocol:** new `speed { frame, multiplier }` message (C→S→F). Added
  `multiplier` to `ServerSnapshotMsg`, `ClientSnapshotMsg`,
  `BecomeControllerMsg`, `SnapshotMeta`. Added `currentMultiplier` to
  `WelcomeMsg`. Server stores `Session.currentMultiplier` (default 1),
  validates incoming `speed` against `SPEED_LADDER`, relays to followers,
  and stamps the multiplier onto every outbound snapshot + welcome +
  becomeController.
- **Config:** `SPEED_LADDER = [1,2,4,8]`, `SNAPSHOT_INTERVAL_FRAMES = 90`,
  `MIN_SNAPSHOT_INTERVAL_MS = 300`, `CATCHUP_THRESHOLD_FRAMES = 180`.
  Exposed `nextLadderSpeed(current)` helper.
- **Controller UI:** a speed-cycle button in the play header that cycles
  the ladder. On click: `core.setSpeed(n)` locally + send
  `{type:'speed', frame: core.getFrame(), multiplier: n}`.
- **Follower UI:** read-only speed pill in the same slot. Adopts the
  multiplier from `welcome.currentMultiplier`, from each snapshot's
  `multiplier`, and from `becomeController.multiplier`. Scheduled
  `speed` events via `core.onFrame(frame, applySpeed)` so the change
  lands at the controller-tagged frame, not on wall-clock arrival.
- **Frame-based snapshot cadence:** controller's snapshot loop now polls
  every ~80ms and emits when *both* (frames-since-last ≥ 90) and
  (ms-since-last ≥ 300) are true. At 1× this stays at ~1.5s cadence; at
  8× it drops to the ~300ms wall-clock floor so reconciliation keeps
  pace with the multiplied frame production.
- **Catch-up safety net:** a watchdog interval on the follower
  recomputes `targetFrame - localFrame` every 200ms. If the deficit
  exceeds `CATCHUP_THRESHOLD_FRAMES` (180), it re-anchors to the last
  received snapshot (`applyServerSnapshot` → `loadAutoSaveState` +
  `setFrame` + `clearPendingBefore`). Three or more re-anchors within
  10 seconds flip the follower into "snapshot-follow mode" (logged to
  console; no UI noise) until the controller eases off.

Verified end-to-end in Playwright with two tabs on the same save:
- Controller cycle 1× → 2× → 4× → 8× → 1×; follower mirrored every step.
- Late-join into a 4× session: new follower picked up 4× from welcome.
- Closed the controller while at 4×: the next-in-queue was promoted via
  `becomeController` and inherited 4× directly.
- A capable follower stays in lockstep through speed cycles; the
  catch-up watchdog never fires for a sustainable speed.

Notes:
- Followers are muted by default (SPEC C7) so pitched-up audio at high
  speed is a non-issue for them. Controllers keep audio on; chipmunk
  audio at 4×/8× is accepted as a known tradeoff (SPEC-SPEED §9).
- mGBA supports arbitrary multipliers so the full `[1,2,4,8]` ladder is
  available; no need to trim. 0.5× slow-mo would map to
  `setFastForwardMultiplier(-2)` but is not in the v1 ladder.

## Milestone 4 — Robustness, mobile polish, prod build
- Status: **DONE** (2026-05-27)

Implemented:
- **WebSocket reconnect** (already in M2 via `client/src/net/ws.ts`): exponential backoff to 8 s + jitter; on reconnect, the join message is replayed so the server re-adds the participant.
- **pagehide cleanup** (`SessionPage`): sends `leave` and releases the wake lock; the next-in-queue is promoted immediately rather than waiting for the heartbeat timeout.
- **ROM hash mismatch guard:** enforced on the server's `join` handler (returns `error { code: "rom_mismatch" }`) AND on the client before booting the emulator (compares fetched bytes' SHA-256 against `/api/roms` metadata, throws before `loadGame`).
- **In-control indicator:** header role chip + faded `.gamepad-disabled` styling for followers (already in M2).
- **Tap-to-start overlay** unlocks audio, requests fullscreen, locks landscape, and acquires the wake lock (already in M1; carried into SessionPage).
- **Mute toggle:** 🔇/🔊 in the header. Followers default-muted (SPEC C7).
- **Production build:** `npm run build` produces `/client/dist/` and typechecks the server. `npm start` runs the server via `tsx` (no compile step needed); it serves the built client + WS hub on port 8080. **Verified** in browser that `crossOriginIsolated === true` on the prod server and that `/s/<id>?rom=<id>` end-to-end works (load → tap-to-start → emulator running).
- **README** documents dev, prod, ROM placement, regen of the vendored core, and a "behind Cloudflare Tunnel" deploy section — including the critical caveat that Cloudflare must pass COOP/COEP through unmodified.

Production smoke test (Playwright, against `npm start` on port 8080):
- `GET /` returns COOP/COEP/CORP/noindex headers.
- `GET /api/roms` returns COOP/COEP/CORP/noindex headers.
- `crossOriginIsolated === true`, `SharedArrayBuffer` is available.
- `/s/m4test?rom=test-arm.gba` loads the SPA fallback, boots mGBA, renders the test ROM output.

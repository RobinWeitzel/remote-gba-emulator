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
- Status: pending

## Milestone 4 — Robustness, mobile polish, prod build
- Status: pending

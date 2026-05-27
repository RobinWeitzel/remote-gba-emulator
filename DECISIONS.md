# Decisions Log

Non-obvious choices made during autonomous build per SPEC.md §0.4.

## Scaffolding (Milestone 0 prep)
- **WebSocket library:** `ws` (per SPEC §5 preference — simpler than socket.io, no rooms/reconnect features we need that we can't do ourselves).
- **HTTP framework:** `fastify` — slightly more ergonomic plugin model than express for static + WS + middleware; minimal footprint.
- **Snapshot transport:** binary WebSocket frames, prefixed by a small JSON header (length-prefixed) — avoids ~33% base64 overhead. (Will validate during M3.)
- **Snapshot compression:** browser `CompressionStream` (gzip) where available; fall back to raw bytes for v1 — keep it simple, test bandwidth in M3.
- **In-memory only:** No DB. Sessions die when empty. Per SPEC §10.4.
- **Worker isolation:** Per SPEC §5, fallback allowed. The vendored core's `mGBA({ canvas: HTMLCanvasElement })` signature implies DOM-bound canvas, and the Emscripten module uses `import.meta.url`-relative wasm loading. **Decision: run mGBA on the main thread for v1.** The core itself uses pthreads internally, so the main-thread JS sees a simple imperative API while the heavy emulation work happens on the core's own worker pool. Documented fallback per SPEC §5. We will revisit worker isolation in M5 if perf is an issue on real Android devices.

## Vendored mGBA WASM core — confirmed API surface (from /client/public/emulator/mgba.d.ts)

Source: `@thenick775/mgba-wasm` v2.4.1 (MPL-2.0). Files vendored at `/client/public/emulator/{mgba.js, mgba.wasm, mgba.d.ts, LICENSE, NOTICE}` and **loaded directly from there, not from `node_modules` at runtime.**

**Construction:**
- `mGBA({ canvas: HTMLCanvasElement }) → Promise<mGBAEmulator>` — default export of mgba.js (ES module, uses `import.meta.url` to find mgba.wasm; vendor must keep them co-located on the served URL).
- After construction: `await Module.FSInit()` — initializes IDBFS mount points.

**ROM loading:**
- `Module.uploadRom(file: File, cb?)` — writes a `File` into the FS at `filePaths().gamePath`. We will construct a `File` from the fetched ROM `ArrayBuffer`: `new File([bytes], 'rom.gba')`.
- `Module.loadGame(romPath: string, savePathOverride?: string): boolean` — boots the ROM. After success: `Module.gameName` and `Module.saveName` are set.
- Lower-level alternative: `Module.FS.writeFile(path, Uint8Array)` then `loadGame(path)`.

**Input:**
- `Module.buttonPress(name: string)` / `Module.buttonUnpress(name: string)` — `name` ∈ `"A", "B", "L", "R", "Start", "Select", "Up", "Down", "Left", "Right"`.
- `Module.toggleInput(enabled: boolean)` — globally enable/disable input handling.

**Lifecycle:**
- `Module.resumeGame()` / `Module.pauseGame()` — run/pause emulation.
- `Module.pauseAudio()` / `Module.resumeAudio()`.
- `Module.setVolume(0..2)` / `Module.getVolume()`.

**Frame counter:** **NOT directly exposed.** Derive via `Module.addCoreCallbacks({ videoFrameEndedCallback })` — increment a counter in the callback. **Required for input tagging in §8.1.** We expose `getFrame()` from our wrapper.

**Save states — IMPORTANT API SHAPE:**
- `Module.saveState(slot: number) → boolean` and `Module.loadState(slot: number) → boolean` are **SLOT-BASED, NOT BYTE-BASED.** They write/read state files in `filePaths().saveStatePath`.
- **For byte-level snapshots over WebSocket, we use the auto-save state mechanism:**
  - Capture: `Module.forceAutoSaveState()` → writes a state file → `Module.getAutoSaveState() → { autoSaveStateName, data: Uint8Array } | null`.
  - Restore: `Module.uploadAutoSaveState(name, data: Uint8Array)` → `Module.loadAutoSaveState() → boolean`.
- Alternative (lower-level): `Module.saveState(slot)` then `Module.FS.readFile(<saveStatePath>/<slot>.ssm)` to get bytes; `Module.FS.writeFile(...)` + `Module.loadState(slot)` to restore. **Will validate which path is more reliable for round-trip in M0.**

**SRAM persistence:** `Module.getSave(): Uint8Array | null` returns the current battery save. The FS itself is mounted on IDBFS in `FSInit()`, with `FSSync()` flushing to IndexedDB, so battery saves persist across reloads automatically.

**Audio:** `Module.SDL2.audioContext: AudioContext` — for unmute on user gesture, etc.

**Cross-origin isolation REQUIRED.** Threaded WASM build.

## Snapshot strategy (validated in M0 — see PROGRESS.md)
- Capture: `forceAutoSaveState()` → `getAutoSaveState()` returns `{ autoSaveStateName, data: Uint8Array }`.
- Restore: `uploadAutoSaveState(name, bytes)` → `loadAutoSaveState() → boolean`.
- We disable mGBA's own periodic auto-save (`setCoreSettings({ autoSaveStateEnable: false, restoreAutoSaveStateOnLoad: false })`) so it doesn't fight with our manual capture cadence.
- `loadAutoSaveState` returns `0` on a freshly-booted core. **A fresh instance must run at least ~5 frames before restore will succeed.** Our `MgbaCore.restoreSnapshot` handles this priming transparently.
- Frame tagging: snapshot message includes the frame counter at capture time. Followers tolerate frame discontinuity across handoffs (SPEC §11.4).
- `addCoreCallbacks` MUST be called AFTER `loadGame`. `loadGame` re-initialises the C-side callback table; callbacks registered before are dropped silently. The wrapper re-arms the frame counter inside `loadRomBytes`.

## Save state format & determinism (M0 findings)
mGBA save states are **PNG files**. Chunks observed in v0.11/feature-wasm-8614:
`IHDR | IDAT | gbAs | gbAx | gbAx(24) | gbAx | IEND`

- The second `gbAx` (24 bytes) varies between back-to-back captures even on a paused core — it encodes the GBA's RTC state, which mGBA pins to wall-clock time.
- The `gbAs` chunk grows by ~32 bytes after a state load — mGBA encodes lifecycle-specific bytes that differ between "freshly booted" and "freshly booted + auto-loaded a state". Benign: the runtime GBA state is correct.

→ **Use `deterministicStateBytes()`** (defined in `client/src/emulator/loadMgba.ts`) for any hash comparison. It strips the 24-byte RTC `gbAx` chunk before hashing.

## Milestone S — Synchronized speed (SPEC-SPEED §3)

mGBA's verified speed API is `Module.setFastForwardMultiplier(n)`:
- `n = 1` → normal speed
- `n > 1` → ×n fast-forward
- `n < 0` → 1/|n| slow-down

We map `MgbaCore.setSpeed(multiplier)` directly onto it; the ladder is
`[1, 2, 4, 8]`. Slow-mo (`0.5×` → `setFastForwardMultiplier(-2)`) is
plumbing-ready but not in the user-visible ladder for v1.

`getFrame` (derived from `videoFrameEndedCallback`) is unaffected by
the multiplier — the wrapper just counts callbacks, so the frame index
remains monotonic across speed changes.

To make controller-frame-tagged speed events fire at the right
emulated moment on each follower, the wrapper exposes
`setFrame(n)` and `clearPendingBefore(n)`. After every applied snapshot
the follower re-anchors its JS frame counter to `snapshot.frame` and
drops any scheduled events that the snapshot has superseded.

## §12.3 vs §12.4 — chosen sync mode for M3
**Use §12.4 ("always reload on snapshot") as the default sync mode** for v1 because:
- Controllers and followers have different lifecycles, so their `gbAs` chunks differ by ~32 bytes ⇒ their det-hashes do NOT match (even though the underlying GBA state is identical after load).
- Comparing follower-det-hash to controller-det-hash will therefore always trigger "mismatch", which collapses §12.3 to §12.4 anyway.
- For turn-based family games at 1.5s snapshot intervals, always-reload is fine. Visual "pop" is unlikely between snapshots — mGBA is deterministic per (input × ROM × build), so the input stream keeps things visually synced.
- `RECONCILE_MODE` env var still defaults to `"hash"` per SPEC §17 — but the hash function used by followers compares against OTHER FOLLOWERS' hashes only. Cross-comparison against controllers is meaningless. We keep the `"always"` option open for §12.4 in M3.

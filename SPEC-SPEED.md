# Watch-Together GBA Emulator — Addendum: Synchronized Emulation Speed Control

> **Save as `SPEC-SPEED.md` in the project root, alongside the existing `SPEC.md`.**
> This is an additive feature spec. It does **not** replace anything in `SPEC.md`; it extends it. All terminology (controller, follower, frame-tagged inputs, snapshots, delay buffer, reconciliation, handoff, the WebSocket protocol, config) is as defined in `SPEC.md`. Section references like "SPEC §8.3" point into that file.

---

## 0. How to use this document (Claude Code)

The base app (SPEC.md Milestones 0–4) is already implemented and working. This addendum adds a single feature: **the controller can change emulation speed, and all followers stay in sync at that speed.** Implement it as one focused milestone (§7 below). Read this whole file first. Use the defaults given. Keep the existing autonomy rules from SPEC.md §0 (record choices in `DECISIONS.md`, verify real emulator API names against the vendored `.d.ts`, commit per milestone, never block).

---

## 1. Chosen approach (read carefully — this is a deliberate decision)

**Fully synchronized speed. The controller AND all followers run at the same elevated (or reduced) speed, kept frame-aligned by treating a speed change as a frame-tagged control event — exactly analogous to an input.**

The alternative — leaving followers at 1× and letting them lurch forward via snapshots while the controller fast-forwards — is **explicitly NOT the default** and must not be implemented as the primary behavior. The only place a follower deviates from the synchronized speed is the catch-up/re-anchor safety net (§5), which is a *degradation path for a device that physically cannot sustain the speed*, not the normal mode.

### Why this is sound (and why the original sync concern dissolves)
Inputs are tagged with a **frame number**, not wall-clock time, and followers apply them when their own emulation *reaches that frame* (SPEC §8.3). When both sides run at the same elevated speed, the follower advances that many more frames per unit of real time, so the wall-clock delay buffer automatically corresponds to proportionally more frames. The condition for an input (or speed change) to arrive in time is simply "network latency < delay buffer," which holds at 1× and at 8× alike. The speed multiplier cancels out. The feature is therefore safe **provided** (a) the speed change itself is synchronized, (b) reconciliation keeps pace with emulated progress, and (c) a follower that can't sustain the speed has a clean way to recover. This addendum specifies exactly those three things.

---

## 2. Protocol additions (extends SPEC §9)

Add one new message to the discriminated union in `/shared/protocol.ts`:

| Direction | `type` | Fields | Meaning |
|---|---|---|---|
| C→S | `speed` | `frame, multiplier` | Controller requests a speed change effective at `frame`. **Server MUST ignore unless sender is the current controller** (same rule as `input`/`snapshot`). |
| S→C | `speed` | `frame, multiplier` | Relayed to followers; each applies it when its frame clock reaches `frame`. |

Extend existing messages to carry the current speed so late joiners and new controllers inherit it:

- **`welcome`** (SPEC §9): add `currentMultiplier: number`. The joining client sets emulator speed to this value as part of bootstrapping from `latestSnapshot`.
- **`snapshot`** (both directions): add `multiplier: number` to the payload metadata. A follower bootstrapping from a stored snapshot uses it to set speed correctly even if it missed the originating `speed` event.
- **`becomeController`** (SPEC §11): add `multiplier: number`. The new controller adopts this speed after `loadState`, before resuming.

`multiplier` is a positive number drawn from the configured ladder (§6). Validate server-side that it is a member of the ladder; reject (drop or `error`) otherwise.

---

## 3. Emulator wrapper addition (extends SPEC §7)

Add to the emulator wrapper:

- `setSpeed(multiplier: number): void` — sets the core's emulation speed / throttle / fast-forward ratio.

**Verify the real API before implementing.** mGBA's WASM bindings expose speed control through a throttle / fast-forward / target-framerate mechanism rather than a literal "setSpeed". Read the vendored `mgba.d.ts` and confirm the actual method (it may be a frame-rate target, a throttle multiplier, or a fast-forward toggle/ratio). Map `setSpeed(multiplier)` onto whatever the real surface is, and record the mapping in `DECISIONS.md`. If only discrete fast-forward is available rather than arbitrary multipliers, constrain the ladder (§6) to what the core actually supports and note it.

`getFrame()` (already implemented) remains the single source of frame numbers and is unaffected by speed — it must keep returning the monotonic emulated frame index regardless of how fast frames are produced.

---

## 4. Frame-based snapshot cadence (modifies SPEC §8.2 behavior)

At elevated speed, far more emulated frames elapse between two wall-clock-spaced snapshots, so any per-frame drift has longer to accumulate before correction. Fix this by making the snapshot trigger **frame-based** rather than purely wall-clock:

- The controller emits a snapshot every `SNAPSHOT_INTERVAL_FRAMES` **emulated frames** (default 90 ≈ 1.5 s at 1×), **subject to a wall-clock floor** `MIN_SNAPSHOT_INTERVAL_MS` (default 300 ms) to bound bandwidth at extreme speeds.
- Concretely: emit a snapshot when *both* "≥ `SNAPSHOT_INTERVAL_FRAMES` frames since last snapshot" *and* "≥ `MIN_SNAPSHOT_INTERVAL_MS` since last snapshot" are true.
- Net effect: at 1× you snapshot ~every 1.5 s as before; at 8× you snapshot roughly every ~300 ms (floor-limited), so reconciliation keeps pace with emulated progress. This stays far below video-level bandwidth and only happens while sped up.

Followers reconcile on each received snapshot exactly as in SPEC §12.3 (hash-compare, `loadState` only on mismatch).

> If the SPEC §12.4 determinism fallback was ever engaged (followers `loadState` every snapshot), the frame-based cadence above is even more important, because speed-up multiplies between-snapshot drift. No other change needed — the more frequent snapshots simply correct more often.

---

## 5. Catch-up / re-anchor safety net (new — the only sanctioned follower deviation)

Even with synchronized speed, a weaker Android follower may be unable to sustain 4×/8× and will fall progressively behind (growing input backlog, growing frame deficit). Handle this per-follower so one slow device never affects the others:

1. Each follower continuously measures how far behind it is — e.g. `targetFrame − localFrame`, or queued-input backlog depth, or wall-clock lag past the delay buffer.
2. If the deficit exceeds `CATCHUP_THRESHOLD_FRAMES` (default 180), the follower **re-anchors**: `loadState` the latest received snapshot, **discard all queued inputs/speed-events with `frame` ≤ that snapshot's frame**, and resume. This produces a visible jump on that one device but restores correctness immediately.
3. If a follower re-anchors repeatedly within a short window (it genuinely can't run the chosen speed), it enters **snapshot-follow mode**: it stops trying to fast-forward through the input stream and instead simply renders each incoming snapshot as a keyframe (loadState every snapshot) until the controller returns to a speed it can sustain, at which point it resumes normal lockstep on the next snapshot. Log entry/exit of this mode to the console for debugging; surface nothing alarming in the UI beyond the normal speed indicator.

This is graceful degradation for the outlier device only. The controller and capable followers continue in smooth synchronized lockstep.

---

## 6. UI (extends SPEC §13)

- **Controller only:** a speed control on the play screen. Default interaction: a button that cycles the ladder `1× → 2× → 4× → 8× → 1×`, or discrete buttons — your choice, keep it thumb-reachable in landscape and out of the way of the gamepad. Changing speed (a) calls `setSpeed` locally at the current frame, and (b) sends `{ type: "speed", frame, multiplier }`.
- **Followers:** a small **read-only** speed indicator showing the current multiplier (e.g. "2×"). Followers cannot change speed; the control is hidden/disabled for them, consistent with how the gamepad is controller-only (SPEC §13.2).
- On **handoff** (SPEC §11), the new controller's UI shows the inherited multiplier and its control becomes active.

---

## 7. Implementation milestone (do as one ordered milestone)

### Milestone S — Synchronized speed control

1. **Wrapper:** add `setSpeed`, mapped to the verified real mGBA API (§3). Confirm `getFrame` is unaffected.
2. **Protocol:** add the `speed` message and extend `welcome`/`snapshot`/`becomeController` with `multiplier`/`currentMultiplier` (§2). Update `/shared/protocol.ts` types.
3. **Server:** store `currentMultiplier` in session state (default 1). Accept `speed` only from the controller; validate against the ladder; update stored multiplier; relay to followers. Include current multiplier in `welcome`, in stored/relayed `snapshot` metadata, and in `becomeController`.
4. **Controller client:** speed UI (§6); on change, apply locally at current frame and send the `speed` event.
5. **Follower client:** apply relayed `speed` events via the existing frame scheduler (when local clock reaches the tagged frame); on a snapshot or `welcome`, set speed from its `multiplier`/`currentMultiplier`.
6. **Cadence:** switch snapshot triggering to frame-based with the wall-clock floor (§4).
7. **Catch-up:** implement the re-anchor + snapshot-follow safety net (§5).
8. **Handoff/late-join:** verify the new controller and late joiners inherit and display the correct speed.

**Acceptance criteria:**
- Controller changes speed; both a controller tab and a follower tab visibly run faster, staying in sync (the follower mirrors the same gameplay, just sped up).
- A snapshot during fast-forward keeps the follower aligned (no growing divergence on a capable device).
- Returning to 1× resumes smooth lockstep with no leftover drift.
- Handoff while sped up: the new controller resumes at the same speed; followers continue correctly.
- A follower joining mid-fast-forward bootstraps at the correct speed from `welcome`.
- **Android throttle test:** artificially throttle one follower tab (Chrome DevTools CPU throttling, or run on a deliberately weaker device); confirm it re-anchors / enters snapshot-follow mode and that the controller and the other (un-throttled) follower are unaffected.

---

## 8. Config additions (extends SPEC §17)

- `SPEED_LADDER = [1, 2, 4, 8]` — allowed multipliers. (Optionally include `0.5` for slow-motion if the human wants slow-downs too; only if the core supports sub-1× throttle — verify and record.)
- `SNAPSHOT_INTERVAL_FRAMES = 90` — primary snapshot trigger (≈1.5 s at 1×). This supersedes the wall-clock `SNAPSHOT_INTERVAL_MS` as the primary trigger; keep the old constant only as documentation of the 1× baseline.
- `MIN_SNAPSHOT_INTERVAL_MS = 300` — wall-clock floor on snapshot frequency, to bound bandwidth at high speed.
- `CATCHUP_THRESHOLD_FRAMES = 180` — frame deficit beyond which a follower re-anchors.

---

## 9. Pitfalls (extends SPEC §20)

- **Tag the speed change with `frame`, never wall-clock time.** Wall-clock tagging reintroduces exactly the desync you were worried about; frame tagging is what makes the multiplier cancel out.
- **Don't forget to propagate `multiplier`** into `welcome`, `snapshot`, and `becomeController` — omitting any one of these breaks late-join or post-handoff speed inheritance.
- **Bandwidth at 8×:** without `MIN_SNAPSHOT_INTERVAL_MS`, frame-based cadence can spam snapshots. Keep the floor.
- **Audio at high speed** is pitched-up/garbled. Followers are muted by default (SPEC C7), so they're unaffected; for the controller, consider auto-muting (or accept the chipmunk audio) while `multiplier > 1`. Record the choice; don't over-engineer.
- **Discrete-only fast-forward cores:** if the verified mGBA API only offers on/off fast-forward at a fixed ratio rather than arbitrary multipliers, trim `SPEED_LADDER` to what's real rather than faking intermediate speeds.
- **Re-anchor must discard stale queued inputs** (≤ snapshot frame) or the follower will replay already-applied inputs after loadState.

## 10. Out of scope
- Per-follower independent speed (everyone shares the controller's speed by design).
- Follower-initiated speed changes (controller-only, like all input).
- Rewind / slow-motion scrubbing beyond a simple optional 0.5× ladder entry.

// Wrapper around the vendored mGBA WASM core.
//
// The core is the @thenick775/mgba-wasm package, vendored at
// /client/public/emulator/mgba.{js,wasm,d.ts}. See DECISIONS.md for the
// confirmed API surface.

import type { GbaButton } from "@gba/shared";

export interface MgbaCore {
  // The raw Module object from mgba.js. See /vendor/mgba/mgba.d.ts for the
  // canonical API surface.
  module: any;
  canvas: HTMLCanvasElement;

  // Frame counter — incremented by videoFrameEndedCallback.
  getFrame(): number;

  // Re-anchor the JS-side frame counter to align with a controller-side
  // frame number (used by followers after applying a snapshot). The
  // counter then continues to increment from `n` as the core advances.
  setFrame(n: number): void;

  // Schedule a callback to fire when the emulator reaches `frame`. Inputs
  // applied this way land at deterministic frame boundaries; do NOT inject
  // inputs via wall-clock polling — that loses sync.
  onFrame(frame: number, cb: () => void): void;

  // Drop any pending onFrame callbacks scheduled for frames ≤ `n`. Used
  // by the follower after a snapshot apply to discard stale events that
  // the snapshot has already superseded (SPEC-SPEED §5).
  clearPendingBefore(n: number): void;

  pressButton(b: GbaButton): void;
  releaseButton(b: GbaButton): void;

  loadRomBytes(name: string, bytes: Uint8Array): Promise<void>;

  pause(): void;
  resume(): void;

  // Byte-level snapshot capture/restore via the auto-save state mechanism.
  // (saveState/loadState are slot-based, not byte-based — see DECISIONS.md.)
  captureSnapshot(): Promise<Uint8Array | null>;
  restoreSnapshot(bytes: Uint8Array): Promise<boolean>;

  setVolume(v: number): void;

  // Synchronized emulation speed (SPEC-SPEED §3). The argument is the
  // ladder multiplier (1, 2, 4, 8). Mapped onto mGBA's verified
  // `setFastForwardMultiplier`: 1=normal, >1 = fast-forward ×N, <0 = slow
  // down (1/abs). We pass the multiplier directly for N≥1; for the
  // optional 0.5× ladder entry, callers should pass -2.
  setSpeed(multiplier: number): void;

  dispose(): void;
}

let factoryPromise: Promise<(opts: { canvas: HTMLCanvasElement }) => Promise<any>> | null = null;

async function loadFactory() {
  if (!factoryPromise) {
    factoryPromise = (async () => {
      // mgba.js lives in /client/public/emulator/ — Vite serves /public
      // verbatim and forbids static imports of those files. Computing the
      // URL at runtime keeps the import outside Vite's static graph.
      const mgbaUrl = new URL("/emulator/mgba.js", window.location.href).href;
      const mod: any = await import(/* @vite-ignore */ mgbaUrl);
      return (mod.default ?? mod) as (opts: { canvas: HTMLCanvasElement }) => Promise<any>;
    })();
  }
  return factoryPromise;
}

// Min frames a freshly-booted core must run BEFORE uploadAutoSaveState +
// loadAutoSaveState will succeed. With no priming frames, loadAutoSaveState
// returns 0 (the core appears to require at least one main-loop iteration to
// initialise the auto-save machinery). 5 is a comfortable margin.
const RESTORE_PRIME_FRAMES = 5;

export async function createMgba(canvas: HTMLCanvasElement): Promise<MgbaCore> {
  const factory = await loadFactory();
  const Module: any = await factory({ canvas });
  await Module.FSInit();

  let frame = 0;
  const pending: { frame: number; cb: () => void }[] = [];

  const onVideoFrameEnded = () => {
    frame++;
    // Pending list stays sorted ascending; pop everything <= current frame.
    while (pending.length > 0 && pending[0].frame <= frame) {
      const item = pending.shift()!;
      try {
        item.cb();
      } catch (e) {
        console.error("onFrame callback threw:", e);
      }
    }
  };

  // IMPORTANT: addCoreCallbacks MUST be called AFTER loadGame. We re-arm it
  // every time loadRomBytes is called.
  const installFrameCounter = () => {
    Module.addCoreCallbacks({ videoFrameEndedCallback: onVideoFrameEnded });
  };

  const core: MgbaCore = {
    module: Module,
    canvas,
    getFrame() {
      return frame;
    },
    setFrame(n) {
      frame = n;
    },
    onFrame(targetFrame, cb) {
      if (frame >= targetFrame) {
        // Already passed — fire next microtask.
        Promise.resolve().then(cb);
        return;
      }
      // Insert sorted by frame.
      let i = pending.length;
      while (i > 0 && pending[i - 1].frame > targetFrame) i--;
      pending.splice(i, 0, { frame: targetFrame, cb });
    },
    clearPendingBefore(n) {
      // pending is sorted ascending; drop everything with frame ≤ n.
      let i = 0;
      while (i < pending.length && pending[i].frame <= n) i++;
      if (i > 0) pending.splice(0, i);
    },
    pressButton(b) {
      Module.buttonPress(b);
    },
    releaseButton(b) {
      Module.buttonUnpress(b);
    },
    async loadRomBytes(name, bytes) {
      const paths = Module.filePaths();
      const romPath = `${paths.gamePath}/${name}`;
      Module.FS.writeFile(romPath, bytes);
      const ok = Module.loadGame(romPath);
      if (!ok) throw new Error(`loadGame failed for ${romPath}`);
      frame = 0;
      pending.length = 0;
      // loadGame resets the core's callback table, so register AFTER load.
      installFrameCounter();
      try {
        Module.setCoreSettings({
          rewindEnable: false,
          autoSaveStateEnable: false,
          restoreAutoSaveStateOnLoad: false,
        });
      } catch (e) {
        console.warn("setCoreSettings failed:", e);
      }
    },
    pause() {
      Module.pauseGame();
    },
    resume() {
      Module.resumeGame();
    },
    async captureSnapshot() {
      const ok = Module.forceAutoSaveState();
      if (!ok) return null;
      const cap = Module.getAutoSaveState();
      if (!cap) return null;
      // Copy bytes out of FS — the returned Uint8Array may be a view into FS
      // memory that becomes invalid after subsequent FS ops.
      return new Uint8Array(cap.data);
    },
    async restoreSnapshot(bytes) {
      // Fresh cores need a few frames of warm-up before loadAutoSaveState
      // will succeed; ensure we have at least RESTORE_PRIME_FRAMES first.
      if (frame < RESTORE_PRIME_FRAMES) {
        await new Promise<void>((res) => this.onFrame(RESTORE_PRIME_FRAMES, res));
      }
      const name = Module.autoSaveStateName;
      await Module.uploadAutoSaveState(name, bytes);
      return Module.loadAutoSaveState();
    },
    setVolume(v) {
      Module.setVolume(v);
    },
    setSpeed(multiplier) {
      // mGBA: 1=normal, >1 = ×N fast-forward, <0 = 1/|N| slow-down.
      // Our ladder is [1, 2, 4, 8] for now; sub-1× would pass -2 etc.
      try {
        Module.setFastForwardMultiplier(multiplier);
      } catch (e) {
        console.warn("setFastForwardMultiplier failed:", e);
      }
    },
    dispose() {
      try {
        Module.quitGame();
      } catch {
        /* ignore */
      }
      try {
        Module.quitMgba();
      } catch {
        /* ignore */
      }
    },
  };

  return core;
}

// ---- Snapshot hash helpers ----
//
// mGBA encodes save states as PNG files. The format we observe in v0.11
// (mgba-wasm 2.4.1) is:
//   IHDR (13B) | IDAT (state body) | gbAs | gbAx | gbAx (24B) | gbAx | IEND
//
// The 24-byte `gbAx` chunk varies between back-to-back captures even on a
// paused emulator — almost certainly the GBA RTC peripheral state encoded
// against wall-clock time. To compute a hash that is stable across instances
// for §12.3 reconcile, we exclude that one chunk before hashing.
//
// Raw bytes are still relayed in full so the receiver gets the source's RTC
// (which is what we want for sync correctness).

interface PngChunk {
  type: string;
  dataOffset: number;
  dataSize: number;
}

function parsePngChunks(buf: Uint8Array): PngChunk[] {
  const chunks: PngChunk[] = [];
  if (buf.length < 8) return chunks;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 8;
  while (off + 12 <= buf.length) {
    const size = dv.getUint32(off, false);
    const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
    chunks.push({ type, dataOffset: off + 8, dataSize: size });
    off += 12 + size;
    if (type === "IEND") break;
  }
  return chunks;
}

export function deterministicStateBytes(buf: Uint8Array): Uint8Array {
  const chunks = parsePngChunks(buf);
  // If it doesn't look like our PNG-wrapped state, fall back to the raw bytes.
  if (chunks.length === 0 || chunks[0].type !== "IHDR") return buf;
  const parts: Uint8Array[] = [];
  let droppedRtc = false;
  for (const c of chunks) {
    if (!droppedRtc && c.type === "gbAx" && c.dataSize === 24) {
      droppedRtc = true;
      continue;
    }
    parts.push(buf.subarray(c.dataOffset, c.dataOffset + c.dataSize));
  }
  const total = parts.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

// Milestone 0 — Determinism spike (SPEC §18 M0).
//
// Goal: verify that two fresh mGBA WASM instances given identical scripted
// inputs reach the same emulator state, AND that a save-state captured from
// one instance can be loaded into another instance.
//
// Findings (recorded in PROGRESS.md):
//   * mGBA encodes save states as PNG files. One 24-byte `gbAx` chunk (the
//     GBA RTC peripheral state) varies between back-to-back captures even on
//     a paused core, so raw-byte hashes are NOT a determinism signal. We
//     strip that chunk before hashing (`deterministicStateBytes`).
//   * With frame-precise input injection (driven by `videoFrameEndedCallback`
//     rather than wall-clock polling), two fresh instances given identical
//     inputs produce identical deterministic hashes.
//   * `uploadAutoSaveState` + `loadAutoSaveState` round-trips state across
//     instances, but the receiving core must have run at least ~5 frames
//     before `loadAutoSaveState` returns true. Handled inside
//     `MgbaCore.restoreSnapshot`.

import { useEffect, useRef, useState } from "react";
import { createMgba, deterministicStateBytes, type MgbaCore } from "../emulator/loadMgba";
import { sha256Hex } from "../lib/hash";
import type { GbaButton } from "@gba/shared";

interface ScriptStep {
  frame: number;
  button: GbaButton;
  pressed: boolean;
}

const INPUT_SCRIPT: ScriptStep[] = [
  { frame: 30, button: "A", pressed: true },
  { frame: 35, button: "A", pressed: false },
  { frame: 60, button: "Start", pressed: true },
  { frame: 65, button: "Start", pressed: false },
  { frame: 100, button: "Right", pressed: true },
  { frame: 130, button: "Right", pressed: false },
  { frame: 160, button: "B", pressed: true },
  { frame: 165, button: "B", pressed: false },
  { frame: 200, button: "Down", pressed: true },
  { frame: 220, button: "Down", pressed: false },
];

const RUN_TO_FRAME = 360;

type Status = "idle" | "running" | "done" | "error";

interface InstanceResult {
  label: string;
  finalFrame: number;
  snapshotSize: number;
  rawHash: string;
  detHash: string;
}

interface SpikeReport {
  ok: boolean;
  message: string;
  results: InstanceResult[];
  detMatch: boolean;
  roundTripOk: boolean;
  roundTripDetMatch: boolean;
}

async function fetchRom(romId: string): Promise<{ bytes: Uint8Array; expectedHash: string }> {
  const list = await fetch("/api/roms").then((r) => r.json());
  const meta = list.roms.find((r: any) => r.id === romId);
  if (!meta) throw new Error(`ROM ${romId} not found in /api/roms`);
  const ab = await fetch(`/api/roms/${romId}`).then((r) => r.arrayBuffer());
  const bytes = new Uint8Array(ab as ArrayBuffer);
  return { bytes, expectedHash: meta.hash };
}

// Schedule inputs at exact frame boundaries using the core's frame callback.
function scheduleInputs(core: MgbaCore, script: ScriptStep[]): void {
  for (const s of script) {
    core.onFrame(s.frame, () => {
      if (s.pressed) core.pressButton(s.button);
      else core.releaseButton(s.button);
    });
  }
}

function runTo(core: MgbaCore, frame: number, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`runTo ${frame} timed out`)), timeoutMs);
    core.onFrame(frame, () => {
      clearTimeout(t);
      resolve();
    });
  });
}

async function bootAndRun(
  romBytes: Uint8Array,
  canvas: HTMLCanvasElement,
  log: (s: string) => void,
): Promise<{ core: MgbaCore; raw: Uint8Array }> {
  log("  init mGBA module…");
  const core = await createMgba(canvas);
  log("  loadRomBytes…");
  await core.loadRomBytes("test-arm.gba", romBytes);
  scheduleInputs(core, INPUT_SCRIPT);
  log("  starting run loop…");
  core.resume();
  log(`  waiting for frame ${RUN_TO_FRAME}…`);
  await runTo(core, RUN_TO_FRAME);
  core.pause();
  log(`  reached frame ${core.getFrame()}`);
  log("  captureSnapshot…");
  const raw = await core.captureSnapshot();
  if (!raw) throw new Error("captureSnapshot returned null");
  log(`  snapshot ${raw.length}B`);
  return { core, raw };
}

export function SpikePage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [report, setReport] = useState<SpikeReport | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const pushLog = (s: string) =>
    setLog((prev) => {
      const next = [...prev, s];
      console.log("[spike]", s);
      return next;
    });

  useEffect(() => {
    const w = window as any;
    pushLog(`crossOriginIsolated = ${w.crossOriginIsolated}`);
    pushLog(`SharedArrayBuffer = ${typeof SharedArrayBuffer !== "undefined" ? "available" : "MISSING"}`);
    if (!w.crossOriginIsolated) {
      pushLog("WARN: cross-origin isolation NOT enabled; threaded mGBA will fail.");
    }
  }, []);

  const run = async () => {
    if (status === "running") return;
    setReport(null);
    setLog([]);
    pushLog(`crossOriginIsolated = ${(window as any).crossOriginIsolated}`);
    setStatus("running");

    const canvas = canvasRef.current!;
    let cleanup: MgbaCore[] = [];
    try {
      pushLog("Fetching ROM…");
      const { bytes, expectedHash } = await fetchRom("test-arm.gba");
      const actualHash = await sha256Hex(bytes);
      pushLog(`ROM ${bytes.length}B  exp=${expectedHash.slice(0, 12)}…  got=${actualHash.slice(0, 12)}…  match=${actualHash === expectedHash}`);

      // --- Run A ---
      pushLog("Run A:");
      const a = await bootAndRun(bytes, canvas, pushLog);
      cleanup.push(a.core);
      const rawA = await sha256Hex(a.raw);
      const detA = await sha256Hex(deterministicStateBytes(a.raw));
      pushLog(`Run A  rawHash=${rawA.slice(0, 20)}…  detHash=${detA.slice(0, 20)}…`);
      a.core.dispose();
      cleanup = [];

      // --- Run B ---
      pushLog("Run B:");
      const b = await bootAndRun(bytes, canvas, pushLog);
      cleanup.push(b.core);
      const rawB = await sha256Hex(b.raw);
      const detB = await sha256Hex(deterministicStateBytes(b.raw));
      pushLog(`Run B  rawHash=${rawB.slice(0, 20)}…  detHash=${detB.slice(0, 20)}…`);

      const detMatch = detA === detB;
      pushLog(`Determinism (det-hash): ${detMatch ? "PASS" : "FAIL"}`);
      pushLog(`Raw-byte match: ${rawA === rawB ? "PASS" : "FAIL (expected — RTC chunk varies)"}`);

      b.core.dispose();
      cleanup = [];

      // --- Runs C & D: two FOLLOWERS load A's snapshot. They must produce
      //     identical detHashes to each other (the relevant condition for
      //     §12.3 hash reconcile). Note: their detHash will NOT match A's,
      //     because mGBA's gbAs chunk encodes lifecycle-specific bytes that
      //     differ between "boot fresh" and "boot fresh + loadAutoSaveState".
      //     That's expected and documented in DECISIONS.md.
      async function followerCapture(label: string) {
        const inst = await createMgba(canvas);
        cleanup.push(inst);
        await inst.loadRomBytes("test-arm.gba", bytes);
        inst.resume();
        const ok = await inst.restoreSnapshot(a.raw);
        inst.pause();
        const snap = await inst.captureSnapshot();
        if (!snap) throw new Error(`Run ${label} captureSnapshot returned null`);
        const r = await sha256Hex(snap);
        const d = await sha256Hex(deterministicStateBytes(snap));
        pushLog(`Run ${label}  restoreOk=${ok}  detHash=${d.slice(0, 20)}…`);
        inst.dispose();
        cleanup = cleanup.filter((x) => x !== inst);
        return { snap, raw: r, det: d, ok: !!ok };
      }

      pushLog("Run C (follower #1): boot fresh, load A's snapshot, capture.");
      const c = await followerCapture("C");
      pushLog("Run D (follower #2): boot fresh, load A's snapshot, capture.");
      const d = await followerCapture("D");

      const restoreOk = c.ok && d.ok;
      const followerMatch = c.det === d.det;
      pushLog(`Followers C and D det-hash match: ${followerMatch ? "PASS" : "FAIL"}`);

      const ok = detMatch && restoreOk && followerMatch;
      const message = ok
        ? "PASS — Determinism confirmed (A=B detHash). Snapshot round-trip succeeds and produces a deterministic follower state (C=D detHash). Note: follower detHash differs from controller's because mGBA's save state encodes lifecycle-specific bytes; M3 should run in §12.4 'always reload' mode for follower→controller reconcile."
        : !detMatch
          ? "FAIL — Controllers A and B diverge with identical inputs. §12.4 fallback required."
          : !restoreOk
            ? "FAIL — restoreSnapshot returned false. §12.4 fallback required."
            : "PARTIAL — Followers diverge after loading the same snapshot. §12.4 fallback required.";

      setReport({
        ok,
        message,
        results: [
          { label: "A", finalFrame: 360, snapshotSize: a.raw.length, rawHash: rawA, detHash: detA },
          { label: "B", finalFrame: 360, snapshotSize: b.raw.length, rawHash: rawB, detHash: detB },
          { label: "C (follower of A)", finalFrame: -1, snapshotSize: c.snap.length, rawHash: c.raw, detHash: c.det },
          { label: "D (follower of A)", finalFrame: -1, snapshotSize: d.snap.length, rawHash: d.raw, detHash: d.det },
        ],
        detMatch,
        roundTripOk: restoreOk,
        roundTripDetMatch: followerMatch,
      });
      setStatus("done");
    } catch (e: any) {
      pushLog(`ERROR: ${e?.message ?? e}`);
      setReport({
        ok: false,
        message: `error: ${e?.message ?? e}`,
        results: [],
        detMatch: false,
        roundTripOk: false,
        roundTripDetMatch: false,
      });
      setStatus("error");
    } finally {
      for (const c of cleanup) {
        try { c.dispose(); } catch { /* ignore */ }
      }
    }
  };

  return (
    <div style={{ padding: 16, fontFamily: "ui-monospace, Menlo, Consolas, monospace", color: "#ddd" }}>
      <h1 style={{ marginTop: 0 }}>M0 — Determinism Spike</h1>
      <p style={{ color: "#aaa" }}>
        Boots three sequential mGBA WASM instances on the same canvas. A &amp; B run identical scripted inputs;
        C loads A's snapshot. See SPEC §18 Milestone 0.
      </p>
      <button
        onClick={run}
        disabled={status === "running"}
        style={{
          background: "#1f7a4a",
          color: "white",
          border: 0,
          padding: "10px 16px",
          fontSize: 16,
          cursor: status === "running" ? "not-allowed" : "pointer",
          opacity: status === "running" ? 0.6 : 1,
        }}
        data-testid="spike-run"
      >
        Run spike
      </button>
      <div style={{ marginTop: 12 }}>Status: <span data-testid="spike-status">{status}</span></div>

      <div style={{ marginTop: 16 }}>
        <canvas ref={canvasRef} width={240} height={160} style={{ width: 240, height: 160, background: "#222", border: "1px solid #444" }} />
      </div>

      {report && (
        <div
          data-testid="spike-report"
          data-spike-ok={report.ok ? "1" : "0"}
          style={{
            marginTop: 16,
            padding: 12,
            background: report.ok ? "#0a2c1c" : "#3a1a1a",
            border: `1px solid ${report.ok ? "#2c8050" : "#a04040"}`,
          }}
        >
          <strong>{report.ok ? "PASS" : "FAIL"}</strong>: {report.message}
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{JSON.stringify(report, null, 2)}</pre>
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>Log</h3>
      <pre style={{ background: "#111", padding: 12, whiteSpace: "pre-wrap" }} data-testid="spike-log">
        {log.join("\n")}
      </pre>
    </div>
  );
}

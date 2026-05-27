// Session screen — emulator + WS-driven sync (M3).
//
// Sync model:
//   - Controller: emits frame-tagged INPUT messages on every press/release,
//     plus a periodic SNAPSHOT (default 1500ms; SPEC §17).
//   - Followers: receive INPUTs (apply immediately — see below) and
//     SNAPSHOTS (always loadAutoSaveState, per DECISIONS.md §12.4 mode).
//   - Controller leaves → next-in-queue receives `becomeController` with the
//     latest stored snapshot. Loads it, swaps role, resumes free play.
//
// We chose §12.4 ("always reload on snapshot") in M0 because mGBA's save
// state PNG encodes lifecycle-specific bytes that differ between freshly-
// booted and freshly-booted-then-loaded instances — so a det-hash compare
// across controller/follower is unreliable. At 1500ms snapshot cadence for
// turn-based games, always-reload is fine.

import { useEffect, useRef, useState } from "react";
import { createMgba, type MgbaCore } from "../emulator/loadMgba";
import { fetchRom, listRoms } from "../lib/api";
import { sha256Hex } from "../lib/hash";
import { acquireWakeLock } from "../lib/wake";
import { Gamepad } from "./Gamepad";
import { navigate, useRoute } from "../lib/router";
import { connect, wsUrl, type NetHandle } from "../net/ws";
import { bytesToBase64, base64ToBytes } from "../lib/b64";
import { DEFAULTS, type Role, type RosterEntry, type ServerMsg, type GbaButton } from "@gba/shared";

type Status = "loading" | "needs-tap" | "running" | "error";

export function SessionPage() {
  const route = useRoute();
  const sessionId = route.path.replace(/^\/s\//, "");
  const romId = route.search.get("rom");
  const initialName = route.search.get("name") ?? localStorage.getItem("name") ?? "";

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const coreRef = useRef<MgbaCore | null>(null);
  const netRef = useRef<NetHandle | null>(null);
  const wakeRef = useRef<{ release(): void } | null>(null);
  const snapshotTimerRef = useRef<number | null>(null);
  // Latest known role — kept in a ref so callbacks see fresh value
  // without recreating handlers on every role change.
  const roleRef = useRef<Role | null>(null);
  const mutedRef = useRef<boolean>(true);
  const lastSnapshotFrameRef = useRef<number>(-1);
  // Snapshots received before tap-to-start (core paused) get buffered and
  // applied after resume. We only keep the latest — older snapshots are
  // strictly less informative.
  const pendingSnapshotRef = useRef<{ data: string; frame: number } | null>(null);
  const runningRef = useRef<boolean>(false);

  const [status, setStatus] = useState<Status>("loading");
  const [err, setErr] = useState<string | null>(null);
  const [romName, setRomName] = useState<string>("");
  const [role, setRole] = useState<Role | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [controllerId, setControllerId] = useState<string | null>(null);
  const [connState, setConnState] = useState<"connecting" | "open" | "closed">("connecting");
  const [muted, setMuted] = useState<boolean>(true);

  // Apply role changes to refs and to the emulator (audio + input gating).
  useEffect(() => {
    roleRef.current = role;
    const core = coreRef.current;
    if (!core) return;
    if (role === "controller") {
      // Controller plays audio (unless explicitly muted) and accepts input.
      core.setVolume(mutedRef.current ? 0 : 1);
      startSnapshotLoop();
    } else {
      // Follower: muted by default (SPEC C7), no input emitted to server.
      core.setVolume(0);
      mutedRef.current = true;
      setMuted(true);
      stopSnapshotLoop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const startSnapshotLoop = () => {
    stopSnapshotLoop();
    snapshotTimerRef.current = window.setInterval(async () => {
      const core = coreRef.current;
      const net = netRef.current;
      if (!core || !net || !net.isOpen()) return;
      if (roleRef.current !== "controller") return;
      try {
        const bytes = await core.captureSnapshot();
        if (!bytes) return;
        const frame = core.getFrame();
        // Avoid sending duplicate snapshots if the core hasn't advanced
        // (can happen briefly after a handoff while paused).
        if (frame === lastSnapshotFrameRef.current) return;
        lastSnapshotFrameRef.current = frame;
        net.send({
          type: "snapshot",
          frame,
          data: bytesToBase64(bytes),
          compressed: false,
          rawSize: bytes.length,
        });
      } catch (e) {
        console.warn("snapshot loop failed:", e);
      }
    }, DEFAULTS.SNAPSHOT_INTERVAL_MS);
  };
  const stopSnapshotLoop = () => {
    if (snapshotTimerRef.current !== null) {
      clearInterval(snapshotTimerRef.current);
      snapshotTimerRef.current = null;
    }
  };

  // Boot emulator + open WS once.
  useEffect(() => {
    if (!romId || !sessionId) {
      setErr("Missing session id or ROM in URL.");
      setStatus("error");
      return;
    }
    let disposed = false;

    (async () => {
      try {
        const roms = await listRoms();
        const meta = roms.find((r) => r.id === romId);
        if (!meta) throw new Error(`ROM ${romId} not in /api/roms`);
        setRomName(meta.name);

        const bytes = await fetchRom(romId);
        const actualHash = await sha256Hex(bytes);
        if (actualHash !== meta.hash) {
          throw new Error(`ROM hash mismatch (expected ${meta.hash.slice(0, 8)}…, got ${actualHash.slice(0, 8)}…)`);
        }

        const canvas = canvasRef.current;
        if (!canvas) throw new Error("canvas not mounted");
        const core = await createMgba(canvas);
        if (disposed) { core.dispose(); return; }
        coreRef.current = core;
        await core.loadRomBytes(romId, bytes);
        core.module.addCoreCallbacks({
          saveDataUpdatedCallback: () => {
            try { core.module.FSSync?.(); } catch (e) { console.warn("FSSync failed:", e); }
          },
        });
        core.setVolume(0); // Start muted until role is decided.
        core.pause();
        setStatus("needs-tap");

        netRef.current = connect({
          url: wsUrl("/ws"),
          onState: setConnState,
          onMessage: handleServerMessage,
          joinMessage: {
            type: "join",
            sessionId,
            name: initialName.trim() || "Anonymous",
            romId,
            romHash: meta.hash,
          },
        });
      } catch (e: any) {
        console.error("SessionPage init failed:", e);
        setErr(e?.message ?? String(e));
        setStatus("error");
      }
    })();

    // Mobile cleanup: pagehide is the reliable signal on Android Chrome
    // and iOS Safari (beforeunload is not). Send `leave` and release wake
    // lock so the next-in-queue gets promoted without waiting for the
    // heartbeat timeout.
    const onPageHide = () => {
      try { netRef.current?.close(); } catch { /* ignore */ }
      try { wakeRef.current?.release(); } catch { /* ignore */ }
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      disposed = true;
      window.removeEventListener("pagehide", onPageHide);
      stopSnapshotLoop();
      try { netRef.current?.close(); } catch { /* ignore */ }
      try { wakeRef.current?.release(); } catch { /* ignore */ }
      try { coreRef.current?.dispose(); } catch { /* ignore */ }
      coreRef.current = null;
      netRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [romId, sessionId]);

  const applyServerSnapshot = async (b64: string, frame: number) => {
    const core = coreRef.current;
    if (!core) return;
    if (!runningRef.current) {
      // Core is still paused (waiting for tap-to-start). Buffer the latest
      // snapshot; we'll apply it once the user starts.
      pendingSnapshotRef.current = { data: b64, frame };
      return;
    }
    const bytes = base64ToBytes(b64);
    try {
      const ok = await core.restoreSnapshot(bytes);
      if (!ok) console.warn("restoreSnapshot returned 0 at frame", frame);
    } catch (e) {
      console.warn("restoreSnapshot threw:", e);
    }
  };

  const handleServerMessage = async (msg: ServerMsg) => {
    switch (msg.type) {
      case "welcome": {
        setSelfId(msg.selfId);
        setRole(msg.role);
        setRoster(msg.roster);
        setControllerId(msg.controllerId);
        if (msg.role === "follower" && msg.latestSnapshot) {
          await applyServerSnapshot(msg.latestSnapshot.data, msg.latestSnapshot.frame);
        }
        break;
      }
      case "roster": {
        setRoster(msg.roster);
        setControllerId(msg.controllerId);
        setSelfId((sid) => {
          if (sid && msg.controllerId) setRole(sid === msg.controllerId ? "controller" : "follower");
          return sid;
        });
        break;
      }
      case "controllerChanged": {
        setControllerId(msg.controllerId);
        setSelfId((sid) => {
          if (sid && msg.controllerId) setRole(sid === msg.controllerId ? "controller" : "follower");
          return sid;
        });
        break;
      }
      case "becomeController": {
        // Load the snapshot (if any) and switch to controller.
        if (msg.data) {
          await applyServerSnapshot(msg.data, msg.frame);
        }
        // Role will also flip via the controllerChanged broadcast — but
        // we eagerly flip here so audio/input/snapshot loop start without
        // waiting for the second message.
        if (selfId) setRole("controller");
        // Take a fresh snapshot immediately so all followers re-sync to
        // the new controller's lifecycle (SPEC §11.4).
        const core = coreRef.current;
        const net = netRef.current;
        if (core && net?.isOpen()) {
          try {
            const b = await core.captureSnapshot();
            if (b) {
              net.send({
                type: "snapshot",
                frame: core.getFrame(),
                data: bytesToBase64(b),
                compressed: false,
                rawSize: b.length,
              });
            }
          } catch (e) {
            console.warn("becomeController snapshot send failed:", e);
          }
        }
        break;
      }
      case "input": {
        // Follower-only: apply immediately. The next snapshot reconciles
        // any drift. (See SPEC §12.4 mode chosen in DECISIONS.md.)
        const core = coreRef.current;
        if (!core) break;
        if (msg.pressed) core.pressButton(msg.button);
        else core.releaseButton(msg.button);
        break;
      }
      case "snapshot": {
        // Follower-only: always reload (§12.4).
        await applyServerSnapshot(msg.data, msg.frame);
        break;
      }
      case "error": {
        setErr(`server: ${msg.code} — ${msg.message}`);
        break;
      }
    }
  };

  const onTapStart = async () => {
    const core = coreRef.current;
    if (!core) return;
    try { await core.module.SDL2?.audioContext?.resume?.(); } catch { /* ignore */ }
    try { await document.documentElement.requestFullscreen?.(); } catch { /* iOS Safari rejects */ }
    try { await (screen.orientation as any)?.lock?.("landscape"); } catch { /* ignore */ }
    try { wakeRef.current = await acquireWakeLock(); } catch { /* ignore */ }
    core.resume();
    runningRef.current = true;
    setStatus("running");
    // Apply any snapshot that arrived while we were waiting for the tap.
    if (pendingSnapshotRef.current) {
      const p = pendingSnapshotRef.current;
      pendingSnapshotRef.current = null;
      await applyServerSnapshot(p.data, p.frame);
    }
    // If we're already the controller (joined into an empty session before
    // anyone else), kick off the snapshot loop.
    if (roleRef.current === "controller") startSnapshotLoop();
  };

  const onBack = () => {
    stopSnapshotLoop();
    try { wakeRef.current?.release(); } catch { /* ignore */ }
    try { netRef.current?.close(); } catch { /* ignore */ }
    try { coreRef.current?.dispose(); } catch { /* ignore */ }
    if (document.fullscreenElement) document.exitFullscreen?.();
    navigate("/");
  };

  const toggleMute = () => {
    const next = !muted;
    mutedRef.current = next;
    setMuted(next);
    coreRef.current?.setVolume(next ? 0 : 1);
  };

  const onPress = (b: GbaButton) => {
    const core = coreRef.current;
    if (!core) return;
    core.pressButton(b);
    if (roleRef.current === "controller") {
      netRef.current?.send({ type: "input", frame: core.getFrame(), button: b, pressed: true });
    }
  };
  const onRelease = (b: GbaButton) => {
    const core = coreRef.current;
    if (!core) return;
    core.releaseButton(b);
    if (roleRef.current === "controller") {
      netRef.current?.send({ type: "input", frame: core.getFrame(), button: b, pressed: false });
    }
  };

  if (status === "error") {
    return (
      <div className="home">
        <div className="error">{err}</div>
        <button onClick={onBack}>Back to home</button>
      </div>
    );
  }

  const isController = role === "controller";

  return (
    <div className="play-shell" data-status={status} data-role={role ?? "unknown"}>
      <div className="play-header">
        <button onClick={onBack}>← Back</button>
        <div className="role-indicator" data-testid="role-indicator">
          {romName} · <span data-testid="role">{role ?? "joining…"}</span>
          <span style={{ color: "#888", marginLeft: 8 }}>· {connState}</span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={toggleMute} data-testid="mute-toggle">{muted ? "🔇" : "🔊"}</button>
          <div style={{ fontSize: 11, color: "#888" }} data-testid="roster-summary">
            {roster.length} {roster.length === 1 ? "player" : "players"}
          </div>
        </div>
      </div>

      <div className="play-canvas-wrap">
        <canvas
          ref={canvasRef}
          width={240}
          height={160}
          className="play-canvas"
          style={{
            width: "min(100vw, calc(100dvh * 240 / 160))",
            height: "auto",
            aspectRatio: "240 / 160",
            maxHeight: "100%",
          }}
        />
      </div>

      <Gamepad onPress={onPress} onRelease={onRelease} disabled={!isController} />

      {status === "needs-tap" && (
        <div className="start-overlay" data-testid="start-overlay">
          <h1>{romName}</h1>
          <p>
            You are joining session <strong>{sessionId}</strong> as a {role ?? "…"}.
          </p>
          <p style={{ color: "var(--muted)" }}>
            Tap below to start. We need the tap to unlock audio and enter
            fullscreen on mobile.
          </p>
          <button onClick={onTapStart} data-testid="tap-to-start">Tap to start</button>
        </div>
      )}
    </div>
  );
}

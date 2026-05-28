// Session screen — emulator + WS-driven sync against a persistent SAVE.
//
// URL: /s/<saveId>   (no ROM in the URL; the server tells us)
//
// Flow:
//   1. Mount the canvas, open the WS, send `join { saveId, name }`.
//   2. Receive `welcome` carrying romId, romHash, saveName, contributors,
//      and the latest snapshot if any.
//   3. Fetch the ROM, hash-check, load into mGBA. If a snapshot was in the
//      welcome, buffer it; apply after tap-to-start.
//   4. From there: controller emits frame-tagged inputs + 1500ms snapshots;
//      followers apply both (snapshots always reload, §12.4 mode).

import { useEffect, useRef, useState } from "react";
import { createMgba, type MgbaCore } from "../emulator/loadMgba";
import { fetchRom, listRoms } from "../lib/api";
import { sha256Hex } from "../lib/hash";
import { acquireWakeLock } from "../lib/wake";
import { Gamepad } from "./Gamepad";
import { navigate, useRoute } from "../lib/router";
import { connect, wsUrl, type NetHandle } from "../net/ws";
import { bytesToBase64, base64ToBytes } from "../lib/b64";
import { getPlayerName, setPlayerName } from "../lib/player";
import { effectiveControlLayout, loadGlobal, useOrientation, useResolvedSettings, type ControlLayout } from "../lib/settings";
import { gradientForName } from "../lib/gradient";
import { Modal, StatusPill } from "./primitives";
import { InGameSheet } from "./InGameSheet";
import {
  DEFAULTS,
  nextLadderSpeed,
  type Role,
  type RosterEntry,
  type ServerMsg,
  type GbaButton,
} from "@gba/shared";

type Status = "loading" | "needs-name" | "needs-tap" | "running" | "error";

export function SessionPage() {
  const route = useRoute();
  const saveId = route.path.replace(/^\/s\//, "");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const coreRef = useRef<MgbaCore | null>(null);
  const netRef = useRef<NetHandle | null>(null);
  const wakeRef = useRef<{ release(): void } | null>(null);
  const snapshotTimerRef = useRef<number | null>(null);
  const roleRef = useRef<Role | null>(null);
  const mutedRef = useRef<boolean>(true);
  const lastSnapshotFrameRef = useRef<number>(-1);
  const lastSnapshotAtMsRef = useRef<number>(0);
  const pendingSnapshotRef = useRef<{ data: string; frame: number; multiplier: number } | null>(null);
  const runningRef = useRef<boolean>(false);
  // Synchronized emulation speed (SPEC-SPEED). Followers track the
  // controller's multiplier via `welcome` / `snapshot` / `speed`.
  const multiplierRef = useRef<number>(1);
  // Frame number of the last snapshot WE RECEIVED from the server (in
  // the controller's frame-space). After a snapshot apply on the
  // follower side we set core.setFrame(this) so the follower's frame
  // counter aligns with the controller's tags.
  const lastReceivedSnapshotFrameRef = useRef<number>(-1);
  // Catch-up state (SPEC-SPEED §5). recentReanchors[] is wall-clock
  // timestamps of recent re-anchor events; when ≥ 3 in 10s, the
  // follower flips into snapshot-follow mode.
  const recentReanchorsRef = useRef<number[]>([]);
  const snapshotFollowModeRef = useRef<boolean>(false);
  // The most recent snapshot we successfully received (kept so we can
  // re-apply it for a re-anchor).
  const lastFullSnapshotRef = useRef<{ data: string; frame: number; multiplier: number } | null>(null);
  // Track whether we've already booted the core, so a reconnect's welcome
  // doesn't try to re-load the ROM into mGBA.
  const coreBootedRef = useRef<boolean>(false);
  // Stash the join name so reconnects use the same player name; if the user
  // edited their name in another tab we don't surprise them mid-session.
  const joinNameRef = useRef<string>("");

  const [status, setStatus] = useState<Status>("loading");
  const [err, setErr] = useState<string | null>(null);
  const [saveName, setSaveName] = useState<string>("");
  const [romName, setRomName] = useState<string>("");
  const [romId, setRomId] = useState<string>("");
  const [role, setRole] = useState<Role | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  // The WS message handler is captured in a closure on first effect run,
  // so `selfId` from React state is stale by the time messages arrive.
  // Mirror it into a ref so handlers always read the freshest value.
  const selfIdRef = useRef<string | null>(null);
  useEffect(() => { selfIdRef.current = selfId; }, [selfId]);
  const [controllerId, setControllerId] = useState<string | null>(null);

  // Derive role from (selfId, controllerId) — server is the source of
  // truth for both, and role is just a function of them. Doing this in
  // an effect instead of inside the message handler avoids the previous
  // setSelfId((sid) => { setRole(...); return sid; }) workaround.
  useEffect(() => {
    if (!selfId || !controllerId) return;
    setRole(selfId === controllerId ? "controller" : "follower");
  }, [selfId, controllerId]);
  const [connState, setConnState] = useState<"connecting" | "open" | "closed">("connecting");
  const [muted, setMuted] = useState<boolean>(true);
  const [contributors, setContributors] = useState<Record<string, number>>({});
  const [playerName, setPlayerNameState] = useState<string>(getPlayerName());
  // Visible speed multiplier (controller can change; followers see read-only).
  const [multiplier, setMultiplier] = useState<number>(1);
  const isLandscape = useOrientation();
  const resolvedSettings = useResolvedSettings(romId || null);
  const orientationLayout = resolvedSettings.buttonLayout
    ? (isLandscape ? resolvedSettings.buttonLayout.orientations.landscape : resolvedSettings.buttonLayout.orientations.portrait)
    : null;
  const [layoutPref, setLayoutPref] = useState<ControlLayout | null>(() => {
    const g = loadGlobal();
    return g.controlLayout === "auto" ? null : g.controlLayout;
  });
  const layout = layoutPref ?? effectiveControlLayout("auto", isLandscape);

  // Reflect role into refs + emulator gating.
  useEffect(() => {
    roleRef.current = role;
    const core = coreRef.current;
    if (!core) return;
    if (role === "controller") {
      core.setVolume(mutedRef.current ? 0 : 1);
      startSnapshotLoop();
    } else {
      core.setVolume(0);
      mutedRef.current = true;
      setMuted(true);
      stopSnapshotLoop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // Follower catch-up watchdog (SPEC-SPEED §5). Every 200 ms we check
  // whether our local frame counter has fallen too far behind the most
  // recently received snapshot frame; if so, re-anchor.
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (roleRef.current !== "follower") return;
      const core = coreRef.current;
      if (!core || !runningRef.current) return;
      const localFrame = core.getFrame();
      const targetFrame = lastReceivedSnapshotFrameRef.current;
      if (targetFrame < 0) return;
      const deficit = targetFrame - localFrame;
      if (deficit > DEFAULTS.CATCHUP_THRESHOLD_FRAMES) {
        reanchorToLatestSnapshot();
      }
    }, 200);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Frame-based snapshot cadence (SPEC-SPEED §4): emit when ≥
  // SNAPSHOT_INTERVAL_FRAMES frames have elapsed AND ≥
  // MIN_SNAPSHOT_INTERVAL_MS wall-clock have elapsed since the last one.
  // The wall-clock floor caps bandwidth at 8× speed.
  const startSnapshotLoop = () => {
    stopSnapshotLoop();
    const tick = async () => {
      const core = coreRef.current;
      const net = netRef.current;
      if (!core || !net || !net.isOpen() || roleRef.current !== "controller") {
        // schedule another check anyway; role may flip
        snapshotTimerRef.current = window.setTimeout(tick, 100);
        return;
      }
      try {
        const frame = core.getFrame();
        const now = performance.now();
        const framesSince = frame - lastSnapshotFrameRef.current;
        const msSince = now - lastSnapshotAtMsRef.current;
        const enoughFrames = framesSince >= DEFAULTS.SNAPSHOT_INTERVAL_FRAMES;
        const enoughMs = msSince >= DEFAULTS.MIN_SNAPSHOT_INTERVAL_MS;
        if (enoughFrames && enoughMs && frame > lastSnapshotFrameRef.current) {
          const bytes = await core.captureSnapshot();
          if (bytes) {
            lastSnapshotFrameRef.current = frame;
            lastSnapshotAtMsRef.current = now;
            net.send({
              type: "snapshot",
              frame,
              data: bytesToBase64(bytes),
              compressed: false,
              rawSize: bytes.length,
              multiplier: multiplierRef.current,
            });
          }
        }
      } catch (e) {
        console.warn("snapshot loop failed:", e);
      }
      // Poll roughly every 80 ms — granular enough to honour
      // MIN_SNAPSHOT_INTERVAL_MS at 8× speed without burning CPU.
      snapshotTimerRef.current = window.setTimeout(tick, 80);
    };
    snapshotTimerRef.current = window.setTimeout(tick, 80);
  };
  const stopSnapshotLoop = () => {
    if (snapshotTimerRef.current !== null) {
      clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = null;
    }
  };

  // The very first thing the WS does is `join`. We need a name before that.
  useEffect(() => {
    if (!saveId) {
      setErr("Missing save id in URL.");
      setStatus("error");
      return;
    }
    if (!playerName.trim()) {
      setStatus("needs-name");
      return;
    }
    joinNameRef.current = playerName.trim();
    setStatus((prev) => (prev === "needs-name" ? "loading" : prev));

    let disposed = false;

    netRef.current = connect({
      url: wsUrl("/ws"),
      onState: setConnState,
      onMessage: (msg) => handleServerMessage(msg).catch((e) => console.error("ws msg", e)),
      joinMessage: {
        type: "join",
        saveId,
        name: joinNameRef.current,
      },
    });

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
      coreBootedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveId, playerName]);

  // Welcome arrives → fetch ROM and boot mGBA (only the first time).
  const ensureCoreBooted = async (welcome: {
    romId: string;
    romHash: string;
    romName: string;
    latestSnapshot: { data: string; frame: number; multiplier: number } | null;
  }) => {
    if (coreBootedRef.current) return;
    coreBootedRef.current = true;
    setRomName(welcome.romName);

    const roms = await listRoms();
    const meta = roms.find((r) => r.id === welcome.romId);
    if (!meta) throw new Error(`ROM ${welcome.romId} not in /api/roms`);
    if (meta.hash !== welcome.romHash) {
      throw new Error(
        `ROM hash mismatch: server expects ${welcome.romHash.slice(0, 8)}…, got ${meta.hash.slice(0, 8)}…. ` +
          `Replace ${welcome.romId} on the server, or contact the save's owner.`,
      );
    }
    const bytes = await fetchRom(welcome.romId);
    const actualHash = await sha256Hex(bytes);
    if (actualHash !== welcome.romHash) {
      throw new Error(`ROM byte hash mismatch (expected ${welcome.romHash.slice(0, 8)}…, got ${actualHash.slice(0, 8)}…).`);
    }

    const canvas = canvasRef.current;
    if (!canvas) throw new Error("canvas not mounted");
    const core = await createMgba(canvas);
    coreRef.current = core;
    await core.loadRomBytes(welcome.romId, bytes);
    core.module.addCoreCallbacks({
      saveDataUpdatedCallback: () => {
        try { core.module.FSSync?.(); } catch (e) { console.warn("FSSync failed:", e); }
      },
    });
    core.setVolume(0);
    core.pause();
    setStatus("needs-tap");

    if (welcome.latestSnapshot) {
      pendingSnapshotRef.current = welcome.latestSnapshot;
    }
  };

  // Apply a snapshot received from the server. Aligns the follower's
  // frame counter to the snapshot's `frame`, sets the multiplier, and
  // drops any scheduled events the snapshot has superseded.
  const applyServerSnapshot = async (b64: string, frame: number, msgMultiplier?: number) => {
    const core = coreRef.current;
    if (!core) return;
    const multiplier = msgMultiplier ?? 1;
    // Remember the most recent applied snapshot so the catchup watchdog
    // has something to re-anchor to — this includes the welcome bootstrap
    // and the `becomeController` payload, not just live `snapshot` msgs.
    lastFullSnapshotRef.current = { data: b64, frame, multiplier };
    if (!runningRef.current) {
      pendingSnapshotRef.current = { data: b64, frame, multiplier };
      return;
    }
    const bytes = base64ToBytes(b64);
    try {
      const ok = await core.restoreSnapshot(bytes);
      if (!ok) console.warn("restoreSnapshot returned 0 at frame", frame);
    } catch (e) {
      console.warn("restoreSnapshot threw:", e);
    }
    // Re-anchor the wrapper's frame counter so subsequent input/speed
    // events tagged in controller-frame-space land correctly. Drop any
    // pending events that the snapshot has superseded.
    core.setFrame(frame);
    core.clearPendingBefore(frame);
    lastReceivedSnapshotFrameRef.current = frame;
    // Apply the snapshot's speed if present.
    if (typeof msgMultiplier === "number" && msgMultiplier > 0) {
      multiplierRef.current = msgMultiplier;
      setMultiplier(msgMultiplier);
      core.setSpeed(msgMultiplier);
    }
  };

  // SPEC-SPEED §5 — re-anchor a follower that has fallen too far behind.
  const reanchorToLatestSnapshot = async () => {
    const core = coreRef.current;
    if (!core || !runningRef.current) return;
    if (!pendingSnapshotRef.current && lastReceivedSnapshotFrameRef.current < 0) return;
    // The most recent snapshot is held in pendingSnapshotRef ONLY when
    // we couldn't apply it (paused). After resume it's already applied.
    // For re-anchor we'd want to re-apply the latest known good
    // snapshot — keep a copy in a ref.
    const last = lastFullSnapshotRef.current;
    if (!last) return;
    console.log("[catchup] re-anchoring to snapshot frame", last.frame);
    await applyServerSnapshot(last.data, last.frame, last.multiplier);
    // Track re-anchor frequency for snapshot-follow mode.
    const now = performance.now();
    const buf = recentReanchorsRef.current;
    buf.push(now);
    while (buf.length && buf[0] < now - 10_000) buf.shift();
    if (buf.length >= 3 && !snapshotFollowModeRef.current) {
      snapshotFollowModeRef.current = true;
      console.warn("[catchup] entering snapshot-follow mode (device can't sustain controller speed)");
    }
  };

  const handleServerMessage = async (msg: ServerMsg) => {
    switch (msg.type) {
      case "welcome": {
        setSelfId(msg.selfId);
        setRoster(msg.roster);
        // Role is derived from (selfId, controllerId) via useEffect.
        setControllerId(msg.controllerId);
        setRomId(msg.romId);
        setSaveName(msg.saveName);
        setContributors(msg.contributors ?? {});
        // Adopt the session's current speed (SPEC-SPEED §2). Stored
        // on the ref now so the snapshot-bootstrap path can apply it
        // even while the core is still paused before tap-to-start.
        const mult = typeof msg.currentMultiplier === "number" && msg.currentMultiplier > 0 ? msg.currentMultiplier : 1;
        multiplierRef.current = mult;
        setMultiplier(mult);
        try {
          await ensureCoreBooted({
            romId: msg.romId,
            romHash: msg.romHash,
            romName: msg.romId.replace(/\.gba$/i, ""), // refined below
            latestSnapshot: msg.latestSnapshot
              ? { data: msg.latestSnapshot.data, frame: msg.latestSnapshot.frame, multiplier: msg.latestSnapshot.multiplier ?? mult }
              : null,
          });
        } catch (e: any) {
          setErr(e?.message ?? String(e));
          setStatus("error");
        }
        // Also fetch the human-readable rom name (welcome carries id only).
        // Cheap: roms list is already cached by the browser.
        try {
          const roms = await listRoms();
          const m = roms.find((r) => r.id === msg.romId);
          if (m) setRomName(m.name);
        } catch { /* non-fatal */ }
        break;
      }
      case "roster": {
        setRoster(msg.roster);
        setControllerId(msg.controllerId);
        break;
      }
      case "controllerChanged": {
        setControllerId(msg.controllerId);
        break;
      }
      case "becomeController": {
        // Adopt the session's speed before resuming (SPEC-SPEED §2).
        const mult = typeof msg.multiplier === "number" && msg.multiplier > 0 ? msg.multiplier : 1;
        multiplierRef.current = mult;
        setMultiplier(mult);
        // The controller does not need the follower-catchup logic.
        // Reset it now so a player who was a struggling follower doesn't
        // carry the stuck-mode flag if they later become follower again.
        snapshotFollowModeRef.current = false;
        recentReanchorsRef.current = [];
        if (msg.data) {
          await applyServerSnapshot(msg.data, msg.frame, mult);
        } else if (coreRef.current) {
          coreRef.current.setSpeed(mult);
        }
        // Optimistic role flip. controllerChanged will arrive next from
        // the server and set the same value; this just shortens the
        // window before the snapshot loop starts on our side. selfIdRef
        // stays fresh across handler-closure captures.
        if (selfIdRef.current) setControllerId(selfIdRef.current);
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
                multiplier: mult,
              });
            }
          } catch (e) {
            console.warn("becomeController snapshot send failed:", e);
          }
        }
        break;
      }
      case "input": {
        // Apply immediately (§12.4 mode). The next snapshot reconciles
        // any drift. Frame-precise scheduling is reserved for speed
        // changes where exact alignment matters.
        const core = coreRef.current;
        if (!core) break;
        if (msg.pressed) core.pressButton(msg.button);
        else core.releaseButton(msg.button);
        break;
      }
      case "snapshot": {
        await applyServerSnapshot(msg.data, msg.frame, msg.multiplier);
        break;
      }
      case "speed": {
        // Frame-tagged speed change. Schedule at the controller-frame;
        // since the follower's wrapper-frame is aligned to the
        // controller via snapshots, this fires at the same emulated
        // moment on both sides.
        const core = coreRef.current;
        if (!core) break;
        const apply = () => {
          const m = msg.multiplier;
          multiplierRef.current = m;
          setMultiplier(m);
          core.setSpeed(m);
        };
        // If the local frame counter has already passed msg.frame, apply
        // immediately — better to apply late than not at all.
        if (core.getFrame() >= msg.frame) apply();
        else core.onFrame(msg.frame, apply);
        break;
      }
      case "contributors": {
        setContributors(msg.contributors);
        break;
      }
      case "error": {
        setErr(`server: ${msg.code} — ${msg.message}`);
        setStatus("error");
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
    if (pendingSnapshotRef.current) {
      const p = pendingSnapshotRef.current;
      pendingSnapshotRef.current = null;
      await applyServerSnapshot(p.data, p.frame, p.multiplier);
    } else {
      // No snapshot to bootstrap from — still apply the session's
      // current multiplier so a fresh save starts at the right speed.
      core.setSpeed(multiplierRef.current);
    }
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

  // Controller-only: hand controls to a specific watcher. The server
  // flips queue order, sends becomeController to the target, and
  // broadcasts controllerChanged so all roles refresh.
  const handover = (toConnId: string) => {
    if (roleRef.current !== "controller") return;
    const net = netRef.current;
    if (!net?.isOpen()) return;
    net.send({ type: "handover", toConnId });
  };

  // Controller-only: cycle through the speed ladder. Apply locally at
  // the current frame AND send a frame-tagged speed event so followers
  // change speed at the same emulated point (SPEC-SPEED §1).
  const cycleSpeed = () => {
    if (roleRef.current !== "controller") return;
    const core = coreRef.current;
    const net = netRef.current;
    if (!core) return;
    const next = nextLadderSpeed(multiplierRef.current);
    multiplierRef.current = next;
    setMultiplier(next);
    core.setSpeed(next);
    const frame = core.getFrame();
    if (net?.isOpen()) {
      net.send({ type: "speed", frame, multiplier: next });
    }
  };

  // ----- needs-name gate: render BEFORE booting WS so we can collect a name -----
  if (status === "needs-name") {
    return (
      <NeedsNameForm
        onSubmit={(n) => { setPlayerName(n); setPlayerNameState(n); }}
        onCancel={() => navigate("/")}
      />
    );
  }

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
    <div
      className="play-shell-v2"
      data-status={status}
      data-role={role ?? "unknown"}
      data-layout={layout}
    >
      {/* Decorative blurred backdrop */}
      <div
        className="play-bg-v2"
        style={{ background: gradientForName(saveName || romName || "?") }}
        aria-hidden
      />

      <div className="play-canvas-wrap-v2">
        <canvas
          ref={canvasRef}
          width={240}
          height={160}
          className="play-canvas-v2"
        />
      </div>

      <Gamepad
        onPress={(b: GbaButton) => {
          const c = coreRef.current; if (!c) return;
          c.pressButton(b);
          if (roleRef.current === "controller") netRef.current?.send({ type: "input", frame: c.getFrame(), button: b, pressed: true });
        }}
        onRelease={(b: GbaButton) => {
          const c = coreRef.current; if (!c) return;
          c.releaseButton(b);
          if (roleRef.current === "controller") netRef.current?.send({ type: "input", frame: c.getFrame(), button: b, pressed: false });
        }}
        disabled={!isController}
        buttonLayout={orientationLayout}
      />

      {connState !== "open" && status === "running" && (
        <StatusPill tone="warn" testId="conn-pill">
          {connState === "connecting" ? "Reconnecting…" : "Connection lost — retrying."}
        </StatusPill>
      )}

      <InGameSheet
        saveName={saveName}
        romName={romName}
        romId={romId}
        saveId={saveId}
        role={role}
        connState={connState}
        roster={roster}
        selfId={selfId}
        multiplier={multiplier}
        muted={muted}
        isController={isController}
        layoutPref={layoutPref}
        effectiveLayout={layout}
        onExit={onBack}
        onCycleSpeed={cycleSpeed}
        onToggleMute={toggleMute}
        onLayoutChange={(v) => setLayoutPref(v === "auto" ? null : v)}
        onHandover={handover}
      />

      {status === "needs-tap" && (
        <Modal open>
          <div style={{ maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "85dvh" }}>
            <div style={{ fontSize: 11, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>{romName}</div>
            <h1 style={{ fontSize: 28, marginBottom: 8 }}>{saveName}</h1>
            <div style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 18 }}>
              {role === "controller" ? "You're in control" : role === "follower" ? "You're watching" : "Joining…"}
            </div>
            <p style={{ color: "var(--fg-muted)", marginBottom: 18 }}>
              Tap below to start. We need the tap to unlock audio and enter fullscreen.
            </p>
            <button
              onClick={onTapStart}
              data-testid="tap-to-start"
              style={{
                background: "var(--accent)", color: "var(--accent-on)",
                border: 0, borderRadius: "var(--r-md)", padding: 16,
                fontSize: 17, fontWeight: 700, cursor: "pointer",
              }}
            >
              Start
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Local controlled form so typing in the input doesn't churn through
// the parent's `playerName` state — that state is a WS-effect dep and
// would tear down and reopen the socket on every keystroke.
function NeedsNameForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<string>("");
  const ok = draft.trim().length > 0;
  const submit = () => { if (ok) onSubmit(draft.trim()); };
  return (
    <div className="home" data-testid="needs-name-form">
      <h1>Pick a name first</h1>
      <p style={{ color: "var(--muted)" }}>
        Your name is shown to other players and tracks how much you've
        contributed to this save. It's saved on this device, so you only
        need to enter it once.
      </p>
      <div className="field">
        <label htmlFor="name">Your player name</label>
        <input
          id="name"
          placeholder="e.g. Robin"
          data-testid="name-input"
          autoFocus
          maxLength={32}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
      </div>
      <button
        onClick={submit}
        className="primary"
        data-testid="name-submit"
        disabled={!ok}
      >
        Continue
      </button>
      <button onClick={onCancel} style={{ marginLeft: 8 }}>Back to home</button>
    </div>
  );
}

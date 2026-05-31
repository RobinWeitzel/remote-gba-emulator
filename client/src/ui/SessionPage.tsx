// Session screen — emulator + RTDB-driven sync (re-platformed from the old
// WebSocket SessionPage onto the BackendAdapter, SPEC-SERVERLESS §11).
//
// URL: #/s/<sessionId>. We must already be a MEMBER (the invite redemption
// happens in JoinPage before navigating here); reconnect() uses the durable
// anonymous credential — no fresh invite needed (§7).
//
// The sync MODEL is unchanged from the server version: the controller emits
// frame-tagged inputs + frame-cadence snapshots; followers apply inputs
// immediately and reconcile/re-anchor from snapshots; speed changes are
// frame-tagged. Only the TRANSPORT (adapter calls instead of ws.send / server
// messages) and IDENTITY/ROM (local hash-gated ROM) changed.

import { useEffect, useRef, useState } from "react";
import { createMgba, type MgbaCore } from "../emulator/loadMgba";
import { sha256Hex } from "../lib/hash";
import { acquireWakeLock } from "../lib/wake";
import { Gamepad } from "./Gamepad";
import { navigate, useRoute, routeUrl } from "../lib/router";
import { getBackend } from "../net/backend";
import { encodeInvite } from "../net/inviteCodec";
import type { BackendAdapter, InviteRef, MemberId, RosterMember, FirebaseConfigLike } from "../net/adapter";
import { getRomBytes, importRom } from "../lib/romStore";
import { rememberSession, touchSession, forgetSession, getMySession } from "../lib/sessionStore";
import { bytesToBase64, base64ToBytes } from "../lib/b64";
import { getPlayerName, setPlayerName } from "../lib/player";
import { effectiveControlLayout, loadGlobal, useOrientation, useResolvedSettings, type ControlLayout } from "../lib/settings";
import { gradientForName } from "../lib/gradient";
import { Modal, StatusPill } from "./primitives";
import { InGameSheet } from "./InGameSheet";
import { DEFAULTS, nextLadderSpeed, type Role, type RosterEntry, type GbaButton } from "@gba/shared";

type Status = "loading" | "needs-name" | "needs-rom" | "needs-tap" | "running" | "error";

// How often the controller writes the durable checkpoint to saves/latest.
const DURABLE_INTERVAL_MS = 30_000;

export function SessionPage() {
  const route = useRoute();
  const sessionId = route.path.replace(/^\/s\//, "");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const coreRef = useRef<MgbaCore | null>(null);
  const adapterRef = useRef<BackendAdapter | null>(null);
  const wakeRef = useRef<{ release(): void } | null>(null);
  const snapshotTimerRef = useRef<number | null>(null);
  const roleRef = useRef<Role | null>(null);
  const mutedRef = useRef<boolean>(true);
  const lastSnapshotFrameRef = useRef<number>(-1);
  const lastSnapshotAtMsRef = useRef<number>(0);
  const pendingSnapshotRef = useRef<{ data: string; frame: number; multiplier: number } | null>(null);
  const runningRef = useRef<boolean>(false);
  const multiplierRef = useRef<number>(1);
  const lastReceivedSnapshotFrameRef = useRef<number>(-1);
  const recentReanchorsRef = useRef<number[]>([]);
  const snapshotFollowModeRef = useRef<boolean>(false);
  const lastFullSnapshotRef = useRef<{ data: string; frame: number; multiplier: number } | null>(null);
  const coreBootedRef = useRef<boolean>(false);
  const joinNameRef = useRef<string>("");
  const romHashRef = useRef<string>("");
  const sessionConfigRef = useRef<FirebaseConfigLike | null>(null);
  // Durable long-term save (§12): a checkpoint that survives everyone leaving,
  // written by the controller every DURABLE_INTERVAL_MS. durableFallback holds a
  // loaded durable save used to bootstrap a session whose live snapshot was
  // pruned (cold rejoin days later).
  const lastDurableAtRef = useRef<number>(0);
  const durableFallbackRef = useRef<{ data: string; frame: number; multiplier: number } | null>(null);
  const controllerStateRef = useRef<{ holder: MemberId | null; queue: MemberId[] }>({ holder: null, queue: [] });
  const rosterRef = useRef<RosterMember[]>([]);

  const [status, setStatus] = useState<Status>("loading");
  const [err, setErr] = useState<string | null>(null);
  const [romName, setRomName] = useState<string>("");
  const [role, setRole] = useState<Role | null>(null);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const selfIdRef = useRef<string | null>(null);
  useEffect(() => { selfIdRef.current = selfId; }, [selfId]);
  const [controllerId, setControllerId] = useState<string | null>(null);
  const [connState, setConnState] = useState<"connecting" | "open" | "closed">("connecting");
  const [muted, setMuted] = useState<boolean>(true);
  const [multiplier, setMultiplier] = useState<number>(1);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [playerName, setPlayerNameState] = useState<string>(getPlayerName());

  const isLandscape = useOrientation();
  const resolvedSettings = useResolvedSettings(romHashRef.current || null);
  const orientationLayout = resolvedSettings.buttonLayout
    ? (isLandscape ? resolvedSettings.buttonLayout.orientations.landscape : resolvedSettings.buttonLayout.orientations.portrait)
    : null;
  const [layoutPref, setLayoutPref] = useState<ControlLayout | null>(() => {
    const g = loadGlobal();
    return g.controlLayout === "auto" ? null : g.controlLayout;
  });
  const layout = layoutPref ?? effectiveControlLayout("auto", isLandscape);

  // Role derives from (selfId, controllerId).
  useEffect(() => {
    if (!selfId) return;
    setRole(controllerId && selfId === controllerId ? "controller" : "follower");
  }, [selfId, controllerId]);

  // Reflect role into refs + emulator gating + snapshot loop. On BECOMING the
  // controller, publish an immediate snapshot so followers reconcile to us
  // (replaces the old `becomeController` bootstrap).
  useEffect(() => {
    const prev = roleRef.current;
    roleRef.current = role;
    const core = coreRef.current;
    if (!core) return;
    if (role === "controller") {
      core.setVolume(mutedRef.current ? 0 : 1);
      startSnapshotLoop();
      if (prev !== "controller" && runningRef.current) {
        publishCurrentSnapshot().catch(() => {});
      }
    } else {
      core.setVolume(0);
      mutedRef.current = true;
      setMuted(true);
      stopSnapshotLoop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // Follower catch-up watchdog (SPEC-SPEED §5) — unchanged.
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (roleRef.current !== "follower") return;
      const core = coreRef.current;
      if (!core || !runningRef.current) return;
      const deficit = lastReceivedSnapshotFrameRef.current - core.getFrame();
      if (lastReceivedSnapshotFrameRef.current >= 0 && deficit > DEFAULTS.CATCHUP_THRESHOLD_FRAMES) {
        reanchorToLatestSnapshot();
      }
    }, 200);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snapshot cadence (SPEC-SPEED §4) — unchanged except the transport call.
  const startSnapshotLoop = () => {
    stopSnapshotLoop();
    const tick = async () => {
      const core = coreRef.current;
      const adapter = adapterRef.current;
      if (!core || !adapter || roleRef.current !== "controller") {
        snapshotTimerRef.current = window.setTimeout(tick, 100);
        return;
      }
      try {
        const frame = core.getFrame();
        const now = performance.now();
        const enoughFrames = frame - lastSnapshotFrameRef.current >= DEFAULTS.SNAPSHOT_INTERVAL_FRAMES;
        const enoughMs = now - lastSnapshotAtMsRef.current >= DEFAULTS.MIN_SNAPSHOT_INTERVAL_MS;
        if (enoughFrames && enoughMs && frame > lastSnapshotFrameRef.current) {
          const bytes = await core.captureSnapshot();
          if (bytes) {
            lastSnapshotFrameRef.current = frame;
            lastSnapshotAtMsRef.current = now;
            const b64 = bytesToBase64(bytes);
            await adapter.publishSnapshot({ frame, data: b64, compressed: false, rawSize: bytes.length, multiplier: multiplierRef.current });
            // Guardrails (§12): the snapshot supersedes the relay streams — prune
            // them so they don't accumulate against the Spark egress/storage cap.
            adapter.pruneRelay().catch(() => {});
            // Durable checkpoint, throttled — survives everyone leaving.
            if (now - lastDurableAtRef.current >= DURABLE_INTERVAL_MS) {
              lastDurableAtRef.current = now;
              adapter.saveDurable("latest", { data: b64, frame, at: Date.now(), by: selfIdRef.current ?? "" }).catch(() => {});
            }
          }
        }
      } catch (e) {
        console.warn("snapshot loop failed:", e);
      }
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

  const publishCurrentSnapshot = async () => {
    const core = coreRef.current;
    const adapter = adapterRef.current;
    if (!core || !adapter) return;
    const b = await core.captureSnapshot();
    if (!b) return;
    await adapter.publishSnapshot({
      frame: core.getFrame(),
      data: bytesToBase64(b),
      compressed: false,
      rawSize: b.length,
      multiplier: multiplierRef.current,
    });
  };

  // Apply a snapshot received from the controller — unchanged logic.
  const applyServerSnapshot = async (b64: string, frame: number, msgMultiplier?: number) => {
    const core = coreRef.current;
    if (!core) return;
    const multiplier = msgMultiplier ?? 1;
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
    core.setFrame(frame);
    core.clearPendingBefore(frame);
    lastReceivedSnapshotFrameRef.current = frame;
    if (typeof msgMultiplier === "number" && msgMultiplier > 0) {
      multiplierRef.current = msgMultiplier;
      setMultiplier(msgMultiplier);
      core.setSpeed(msgMultiplier);
    }
  };

  const reanchorToLatestSnapshot = async () => {
    const core = coreRef.current;
    if (!core || !runningRef.current) return;
    const last = lastFullSnapshotRef.current;
    if (!last) return;
    await applyServerSnapshot(last.data, last.frame, last.multiplier);
    const now = performance.now();
    const buf = recentReanchorsRef.current;
    buf.push(now);
    while (buf.length && buf[0] < now - 10_000) buf.shift();
    if (buf.length >= 3 && !snapshotFollowModeRef.current) {
      snapshotFollowModeRef.current = true;
      console.warn("[catchup] entering snapshot-follow mode");
    }
  };

  // ---- bootstrap: connect to the session, gate on ROM, boot the core ----
  useEffect(() => {
    if (!sessionId) { setErr("Missing session id in URL."); setStatus("error"); return; }
    if (!playerName.trim()) { setStatus("needs-name"); return; }
    joinNameRef.current = playerName.trim();
    let disposed = false;

    // Resolve which Firebase project this session lives on (own game or one we
    // were invited to — possibly someone else's project). We only know sessions
    // we created or were invited to.
    const stored = getMySession(sessionId);
    if (!stored) {
      setErr("This game isn't on this device. Open the invite link you were sent.");
      setStatus("error");
      return;
    }
    sessionConfigRef.current = stored.config;
    if (stored.romName) setRomName(stored.romName);
    if (stored.romHash) romHashRef.current = stored.romHash;

    (async () => {
      let adapter: BackendAdapter;
      try {
        adapter = await getBackend(stored.config);
      } catch (e: any) {
        if (disposed) return;
        setErr(`Connection failed: ${e?.message ?? e}`);
        setStatus("error");
        return;
      }
      adapterRef.current = adapter;
      setSelfId(adapter.currentMemberId());

      try {
        await adapter.reconnect(sessionId, { name: joinNameRef.current });
      } catch (e: any) {
        if (disposed) return;
        setErr(e?.message ?? String(e));
        setStatus("error");
        return;
      }
      if (disposed) return;

      const meta = await adapter.getSessionMeta(sessionId);
      if (!meta) { setErr("This session no longer exists."); setStatus("error"); return; }
      romHashRef.current = meta.romHash;
      setRomName(meta.romName);
      multiplierRef.current = meta.speedMultiplier || 1;
      setMultiplier(meta.speedMultiplier || 1);
      rememberSession({ sessionId, config: stored.config, romName: meta.romName, romHash: meta.romHash, role: adapter.isOwner() ? "owner" : "member" });

      // Wire listeners.
      adapter.onConnected((c) => setConnState(c ? "open" : "closed"));
      adapter.onRoster((m) => { rosterRef.current = m; setRoster(m); });
      adapter.onControllerState(({ holder, queue }) => {
        controllerStateRef.current = { holder, queue };
        setControllerId(holder);
        if (holder === null) scheduleAutoClaim(queue);
      });
      adapter.onInput((msg) => {
        if (msg.by === selfIdRef.current) return; // ignore our own echo
        const core = coreRef.current;
        if (!core) return;
        if (msg.pressed) core.pressButton(msg.button); else core.releaseButton(msg.button);
      });
      adapter.onSpeed((msg) => {
        if (msg.by === selfIdRef.current) return;
        const core = coreRef.current;
        if (!core) return;
        const apply = () => {
          multiplierRef.current = msg.multiplier;
          setMultiplier(msg.multiplier);
          core.setSpeed(msg.multiplier);
        };
        if (core.getFrame() >= msg.frame) apply(); else core.onFrame(msg.frame, apply);
      });
      adapter.onSnapshot((msg) => {
        if (msg.by === selfIdRef.current) return; // don't reload our own snapshot
        applyServerSnapshot(msg.data, msg.frame, msg.multiplier).catch(() => {});
      });

      // Durable checkpoint fallback (§12): if a cold rejoin finds no live
      // snapshot (sync/snapshot was pruned after everyone left), bootstrap from
      // saves/latest. A live onSnapshot, if any, overrides this with newer data.
      adapter.loadDurable("latest").then((s) => {
        if (s && !pendingSnapshotRef.current) {
          durableFallbackRef.current = { data: s.data, frame: s.frame, multiplier: 1 };
        }
      }).catch(() => {});

      // ROM gate (§8): need a byte-identical local ROM.
      const bytes = await getRomBytes(meta.romHash);
      if (!bytes) { if (!disposed) setStatus("needs-rom"); return; }
      await bootCore(meta.romName, bytes);
    })();

    const onPageHide = () => {
      try { adapterRef.current?.leaveSession(); } catch { /* ignore */ }
      try { wakeRef.current?.release(); } catch { /* ignore */ }
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      disposed = true;
      window.removeEventListener("pagehide", onPageHide);
      stopSnapshotLoop();
      try { adapterRef.current?.leaveSession(); } catch { /* ignore */ }
      try { wakeRef.current?.release(); } catch { /* ignore */ }
      try { coreRef.current?.dispose(); } catch { /* ignore */ }
      coreRef.current = null;
      adapterRef.current = null;
      coreBootedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, playerName]);

  const bootCore = async (label: string, bytes: Uint8Array) => {
    if (coreBootedRef.current) return;
    coreBootedRef.current = true;
    const canvas = canvasRef.current;
    if (!canvas) throw new Error("canvas not mounted");
    const core = await createMgba(canvas);
    coreRef.current = core;
    await core.loadRomBytes(label.replace(/[^\w.-]/g, "_") + ".gba", bytes);
    core.module.addCoreCallbacks({
      saveDataUpdatedCallback: () => { try { core.module.FSSync?.(); } catch { /* ignore */ } },
    });
    core.setVolume(0);
    core.pause();
    setStatus("needs-tap");
  };

  // needs-rom flow: user picks a local file; we hash-gate it (§8).
  const onPickRom = async (file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = await sha256Hex(bytes);
      if (hash !== romHashRef.current) {
        setErr(
          `That ROM doesn't match this game. This session needs the exact ROM for "${romName}". ` +
            `Ask whoever set up the game which version to use. (Your file's fingerprint ${hash.slice(0, 8)}… ≠ ${romHashRef.current.slice(0, 8)}…)`,
        );
        setStatus("error");
        return;
      }
      await importRom(file.name, bytes); // cache for next time
      await bootCore(romName, bytes);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setStatus("error");
    }
  };

  // ---- next-in-queue auto-claim (§11) ----
  const scheduleAutoClaim = (queue: MemberId[]) => {
    const me = selfIdRef.current;
    if (!me) return;
    const online = new Set(rosterRef.current.filter((r) => r.online).map((r) => r.id));
    const eligible = queue.filter((id) => online.has(id));
    const idx = eligible.indexOf(me);
    // Earliest eligible (lowest queue index) claims first; others back off and
    // bail once someone has taken it. The transaction guarantees one winner.
    const rank = idx < 0 ? eligible.length + 1 : idx;
    const delay = rank * 250 + Math.random() * 120;
    window.setTimeout(async () => {
      if (controllerStateRef.current.holder !== null) return;
      const adapter = adapterRef.current;
      if (!adapter) return;
      try { await adapter.claimControl(); } catch { /* ignore */ }
    }, delay);
  };

  const onTapStart = async () => {
    const core = coreRef.current;
    if (!core) return;
    try { await core.module.SDL2?.audioContext?.resume?.(); } catch { /* ignore */ }
    try { wakeRef.current = await acquireWakeLock(); } catch { /* ignore */ }
    core.resume();
    runningRef.current = true;
    setStatus("running");
    touchSession(sessionId);
    if (pendingSnapshotRef.current) {
      const p = pendingSnapshotRef.current;
      pendingSnapshotRef.current = null;
      await applyServerSnapshot(p.data, p.frame, p.multiplier);
    } else if (durableFallbackRef.current) {
      // No live snapshot — resume from the durable checkpoint (§12).
      const d = durableFallbackRef.current;
      durableFallbackRef.current = null;
      await applyServerSnapshot(d.data, d.frame, d.multiplier);
    } else {
      core.setSpeed(multiplierRef.current);
    }
    if (roleRef.current === "controller") startSnapshotLoop();
  };

  const onBack = () => {
    stopSnapshotLoop();
    try { wakeRef.current?.release(); } catch { /* ignore */ }
    try { adapterRef.current?.leaveSession(); } catch { /* ignore */ }
    try { coreRef.current?.dispose(); } catch { /* ignore */ }
    navigate("/");
  };

  const toggleMute = () => {
    const next = !muted;
    mutedRef.current = next;
    setMuted(next);
    coreRef.current?.setVolume(next ? 0 : 1);
  };

  const cycleSpeed = () => {
    if (roleRef.current !== "controller") return;
    const core = coreRef.current;
    const adapter = adapterRef.current;
    if (!core) return;
    const next = nextLadderSpeed(multiplierRef.current);
    multiplierRef.current = next;
    setMultiplier(next);
    core.setSpeed(next);
    const frame = core.getFrame();
    adapter?.sendSpeed({ frame, multiplier: next });
    adapter?.publishSpeedMeta(next);
  };

  // Directed handover (§11): queue target first, release; their auto-claim picks it up.
  const handover = (toId: string) => {
    if (roleRef.current !== "controller") return;
    adapterRef.current?.requestHandover(toId).catch(() => {});
  };

  // Take control when the seat is free.
  const takeControl = () => {
    adapterRef.current?.claimControl().catch(() => {});
  };

  const endGame = async () => {
    const adapter = adapterRef.current;
    if (!adapter || !adapter.isOwner()) return;
    if (!window.confirm("End this game for everyone and delete it? This can't be undone.")) return;
    stopSnapshotLoop();
    try { await adapter.deleteSession(); } catch (e) { console.warn("deleteSession failed", e); }
    forgetSession(sessionId);
    try { wakeRef.current?.release(); } catch { /* ignore */ }
    try { coreRef.current?.dispose(); } catch { /* ignore */ }
    navigate("/");
  };

  const mintInvite = async () => {
    const adapter = adapterRef.current;
    const cfg = sessionConfigRef.current;
    if (!adapter || !adapter.isOwner() || !cfg) return;
    try {
      const ref: InviteRef = await adapter.mintInvite();
      // The link carries the OWNER'S config so the invited device can connect to
      // the owner's project — the config is never baked into the app build.
      const blob = encodeInvite({ config: cfg, sessionId: ref.sessionId, inviteId: ref.inviteId, romName });
      const url = routeUrl(`/join?d=${blob}`);
      setInviteUrl(url);
      try { await navigator.clipboard?.writeText(url); } catch { /* ignore */ }
    } catch (e) {
      console.warn("mintInvite failed", e);
    }
  };

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
        <div className="error" data-testid="session-error">{err}</div>
        <button onClick={onBack}>Back to home</button>
      </div>
    );
  }

  // NOTE: needs-rom is rendered as an overlay inside the main tree below — NOT
  // as an early return — so the <canvas> stays mounted and bootCore() (called
  // from onPickRom) can find it. (An early return here left the canvas
  // unmounted → "canvas not mounted".)

  const isController = role === "controller";
  const controllerFree = controllerId === null;
  const rosterEntries: RosterEntry[] = roster.map((m) => ({
    id: m.id,
    name: m.name + (m.online ? "" : " (away)"),
    role: m.id === controllerId ? "controller" : "follower",
  }));

  return (
    <div className="play-shell-v2" data-status={status} data-role={role ?? "unknown"} data-layout={layout}>
      <div className="play-bg-v2" style={{ background: gradientForName(romName || "?") }} aria-hidden />

      <div className="play-canvas-wrap-v2">
        <canvas ref={canvasRef} width={240} height={160} className="play-canvas-v2" />
      </div>

      <Gamepad
        onPress={(b: GbaButton) => {
          const c = coreRef.current; if (!c) return;
          c.pressButton(b);
          if (roleRef.current === "controller") adapterRef.current?.sendInput({ frame: c.getFrame(), button: b, pressed: true });
        }}
        onRelease={(b: GbaButton) => {
          const c = coreRef.current; if (!c) return;
          c.releaseButton(b);
          if (roleRef.current === "controller") adapterRef.current?.sendInput({ frame: c.getFrame(), button: b, pressed: false });
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
        saveName={romName}
        romName={romName}
        romId={romHashRef.current}
        saveId={sessionId}
        role={role}
        connState={connState}
        roster={rosterEntries}
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
        selfUid={selfId}
        isOwner={!!adapterRef.current?.isOwner()}
        controllerFree={controllerFree}
        onTakeControl={takeControl}
        inviteUrl={inviteUrl}
        onMintInvite={mintInvite}
        onEndGame={endGame}
      />

      {status === "needs-rom" && (
        <Modal open>
          <div data-testid="needs-rom" style={{ maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "85dvh" }}>
            <div style={{ fontSize: 11, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>{romName}</div>
            <h1 style={{ fontSize: 28, marginBottom: 8 }}>Load your ROM</h1>
            <p style={{ color: "var(--fg-muted)", marginBottom: 18 }}>
              This game runs on your own copy of <strong>{romName}</strong>. Pick your local ROM
              file — it stays on this device and is matched by fingerprint so everyone plays
              byte-identical content. It’s never uploaded or shared.
            </p>
            <input
              type="file"
              accept=".gba,.gb,.gbc,application/octet-stream"
              data-testid="rom-file-input"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickRom(f); }}
            />
            <button onClick={onBack} style={{ marginTop: 16, alignSelf: "flex-start" }}>Back to home</button>
          </div>
        </Modal>
      )}

      {status === "needs-tap" && (
        <Modal open>
          <div style={{ maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "85dvh" }}>
            <div style={{ fontSize: 11, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>{romName}</div>
            <h1 style={{ fontSize: 28, marginBottom: 8 }}>Ready to play</h1>
            <div style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 18 }}>
              {role === "controller" ? "You're in control" : role === "follower" ? "You're watching" : "Joining…"}
            </div>
            <p style={{ color: "var(--fg-muted)", marginBottom: 18 }}>Tap below to start. We need the tap to unlock audio.</p>
            <button
              onClick={onTapStart}
              data-testid="tap-to-start"
              style={{ background: "var(--accent)", color: "var(--accent-on)", border: 0, borderRadius: "var(--r-md)", padding: 16, fontSize: 17, fontWeight: 700, cursor: "pointer" }}
            >
              Start
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function NeedsNameForm({ onSubmit, onCancel }: { onSubmit: (name: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<string>("");
  const ok = draft.trim().length > 0;
  const submit = () => { if (ok) onSubmit(draft.trim()); };
  return (
    <div className="home" data-testid="needs-name-form">
      <h1>Pick a name first</h1>
      <p style={{ color: "var(--muted)" }}>
        Your name is shown to other players. It’s saved on this device, so you only need to enter it once.
      </p>
      <div className="field">
        <label htmlFor="name">Your player name</label>
        <input id="name" placeholder="e.g. Robin" data-testid="name-input" autoFocus maxLength={32}
          value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      </div>
      <button onClick={submit} className="primary" data-testid="name-submit" disabled={!ok}>Continue</button>
      <button onClick={onCancel} style={{ marginLeft: 8 }}>Back to home</button>
    </div>
  );
}

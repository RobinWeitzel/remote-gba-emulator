// Session screen — same emulator UX as PlayPage, plus a WebSocket-driven
// session/roster. For M2 the session just tracks roles and roster (no
// input/snapshot sync); M3 layers sync on top.

import { useEffect, useRef, useState } from "react";
import { createMgba, type MgbaCore } from "../emulator/loadMgba";
import { fetchRom, listRoms } from "../lib/api";
import { sha256Hex } from "../lib/hash";
import { acquireWakeLock } from "../lib/wake";
import { Gamepad } from "./Gamepad";
import { navigate, useRoute } from "../lib/router";
import { connect, wsUrl, type NetHandle } from "../net/ws";
import type { Role, RosterEntry, ServerMsg } from "@gba/shared";

type Status = "loading" | "needs-tap" | "running" | "error";

export function SessionPage() {
  const route = useRoute();
  // /s/<sessionId>?rom=<id>&name=<n>
  const sessionId = route.path.replace(/^\/s\//, "");
  const romId = route.search.get("rom");
  const initialName = route.search.get("name") ?? localStorage.getItem("name") ?? "";

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const coreRef = useRef<MgbaCore | null>(null);
  const netRef = useRef<NetHandle | null>(null);
  const wakeRef = useRef<{ release(): void } | null>(null);

  const [status, setStatus] = useState<Status>("loading");
  const [err, setErr] = useState<string | null>(null);
  const [romName, setRomName] = useState<string>("");
  const [role, setRole] = useState<Role | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [controllerId, setControllerId] = useState<string | null>(null);
  const [connState, setConnState] = useState<"connecting" | "open" | "closed">("connecting");

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
        // M2: no audio per-role rule yet; default to muted in followers later (M3).
        core.setVolume(1);
        core.pause();
        setStatus("needs-tap");

        // Open WS, send join.
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

    return () => {
      disposed = true;
      try { netRef.current?.close(); } catch { /* ignore */ }
      try { wakeRef.current?.release(); } catch { /* ignore */ }
      try { coreRef.current?.dispose(); } catch { /* ignore */ }
      coreRef.current = null;
      netRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [romId, sessionId]);

  const handleServerMessage = (msg: ServerMsg) => {
    switch (msg.type) {
      case "welcome":
        setSelfId(msg.selfId);
        setRole(msg.role);
        setRoster(msg.roster);
        setControllerId(msg.controllerId);
        if (msg.role === "follower" && coreRef.current && msg.latestSnapshot) {
          // M3 will reconcile from snapshot; for M2 we just log it.
          console.log("[session] welcome with snapshot frame=", msg.latestSnapshot.frame);
        }
        break;
      case "roster":
        setRoster(msg.roster);
        setControllerId(msg.controllerId);
        // role can change via controllerChanged; keep it derived from
        // controllerId if we already know selfId.
        setSelfId((sid) => {
          if (sid && msg.controllerId) setRole(sid === msg.controllerId ? "controller" : "follower");
          return sid;
        });
        break;
      case "controllerChanged":
        setControllerId(msg.controllerId);
        setSelfId((sid) => {
          if (sid && msg.controllerId) setRole(sid === msg.controllerId ? "controller" : "follower");
          return sid;
        });
        break;
      case "becomeController":
        // M3 will load this snapshot. M2 ignores the bytes; the role swap
        // already happened via controllerChanged.
        console.log("[session] becomeController frame=", msg.frame);
        break;
      case "input":
      case "snapshot":
        // M2 ignores these — M3 will wire them through to the emulator.
        break;
      case "error":
        setErr(`server: ${msg.code} — ${msg.message}`);
        break;
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
    setStatus("running");
  };

  const onBack = () => {
    try { wakeRef.current?.release(); } catch { /* ignore */ }
    try { netRef.current?.close(); } catch { /* ignore */ }
    try { coreRef.current?.dispose(); } catch { /* ignore */ }
    if (document.fullscreenElement) document.exitFullscreen?.();
    navigate("/");
  };

  // Inputs are sent locally to the emulator regardless of role (so followers
  // see the gamepad press visually, but M3's mute-input-when-follower will
  // be the layer that actually drops them from sync). For M2, controller's
  // gamepad activates the emulator; follower's gamepad is hidden.
  const onPress = (b: any) => coreRef.current?.pressButton(b);
  const onRelease = (b: any) => coreRef.current?.releaseButton(b);

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
        <div style={{ fontSize: 11, color: "#888" }} data-testid="roster-summary">
          {roster.length} {roster.length === 1 ? "player" : "players"}
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

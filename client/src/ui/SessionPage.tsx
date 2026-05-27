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
import { formatMs, getPlayerName, setPlayerName } from "../lib/player";
import { useControlLayout } from "../lib/settings";
import { SettingsMenu } from "./SettingsMenu";
import { Avatar } from "./Avatar";
import { IconBack, IconMuted, IconShare, IconUnmuted } from "./icons";
import {
  DEFAULTS,
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
  const pendingSnapshotRef = useRef<{ data: string; frame: number } | null>(null);
  const runningRef = useRef<boolean>(false);
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
  const [role, setRole] = useState<Role | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [controllerId, setControllerId] = useState<string | null>(null);
  const [connState, setConnState] = useState<"connecting" | "open" | "closed">("connecting");
  const [muted, setMuted] = useState<boolean>(true);
  const [contributors, setContributors] = useState<Record<string, number>>({});
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [playerName, setPlayerNameState] = useState<string>(getPlayerName());
  const { layout, pref: layoutPref, setPref: setLayoutPref } = useControlLayout();

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
    latestSnapshot: { data: string; frame: number } | null;
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

  const applyServerSnapshot = async (b64: string, frame: number) => {
    const core = coreRef.current;
    if (!core) return;
    if (!runningRef.current) {
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
        setSaveName(msg.saveName);
        setContributors(msg.contributors ?? {});
        try {
          await ensureCoreBooted({
            romId: msg.romId,
            romHash: msg.romHash,
            romName: msg.romId.replace(/\.gba$/i, ""), // refined below
            latestSnapshot: msg.latestSnapshot ? { data: msg.latestSnapshot.data, frame: msg.latestSnapshot.frame } : null,
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
        if (msg.data) {
          await applyServerSnapshot(msg.data, msg.frame);
        }
        if (selfId) setRole("controller");
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
        const core = coreRef.current;
        if (!core) break;
        if (msg.pressed) core.pressButton(msg.button);
        else core.releaseButton(msg.button);
        break;
      }
      case "snapshot": {
        await applyServerSnapshot(msg.data, msg.frame);
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
      await applyServerSnapshot(p.data, p.frame);
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

  const shareUrl = (() => {
    const u = new URL(window.location.href);
    return u.toString();
  })();

  const showToast = (msg: string) => {
    setShareToast(msg);
    window.setTimeout(() => setShareToast(null), 2500);
  };

  const onShare = async () => {
    const nav: any = navigator;
    if (typeof nav.share === "function") {
      try {
        await nav.share({
          title: `${saveName} — Watch-Together GBA`,
          text: `Join my GBA save "${saveName}"`,
          url: shareUrl,
        });
        return;
      } catch (e: any) {
        if (e?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast("Save link copied to clipboard");
    } catch {
      window.prompt("Copy this save link:", shareUrl);
    }
  };

  // ----- needs-name gate: render BEFORE booting WS so we can collect a name -----
  if (status === "needs-name") {
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
            onChange={(e) => setPlayerNameState(e.target.value)}
          />
        </div>
        <button
          onClick={() => {
            const trimmed = (document.getElementById("name") as HTMLInputElement | null)?.value?.trim() ?? "";
            if (!trimmed) return;
            setPlayerName(trimmed);
            setPlayerNameState(trimmed);
          }}
          className="primary"
          data-testid="name-submit"
        >
          Continue
        </button>
        <button onClick={() => navigate("/")} style={{ marginLeft: 8 }}>Back to home</button>
      </div>
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
  const contributorEntries = Object.entries(contributors).sort((a, b) => b[1] - a[1]);

  return (
    <div
      className="play-shell"
      data-status={status}
      data-role={role ?? "unknown"}
      data-layout={layout}
    >
      <div className="play-header">
        <button onClick={onBack} title="Back to home" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <IconBack size={12} /> <span>Back</span>
        </button>
        <div className="role-indicator" data-testid="role-indicator">
          <strong>{saveName || "…"}</strong>
          <span className="rom-name" style={{ color: "var(--muted)" }}>{romName}</span>
          <span className="save-id-chip" data-testid="save-id-chip">#{saveId}</span>
          <span className="conn-state" style={{ color: "var(--muted-soft)" }}>
            · <span data-testid="role">{role ?? "joining…"}</span> · {connState}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={onShare} className="share-btn" data-testid="share-btn" title="Copy or share the save URL"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <IconShare size={12} /> <span>Share</span>
          </button>
          <button onClick={toggleMute} data-testid="mute-toggle" title={muted ? "Unmute" : "Mute"}
                  style={{ display: "inline-flex", alignItems: "center" }}>
            {muted ? <IconMuted size={14} /> : <IconUnmuted size={14} />}
          </button>
          <SettingsMenu pref={layoutPref} effective={layout} onChange={setLayoutPref} />
          <span style={{ fontSize: 11, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 4 }}
                data-testid="roster-summary"
                title={`${roster.length} ${roster.length === 1 ? "player" : "players"} in session`}>
            <div style={{ display: "flex" }}>
              {roster.slice(0, 4).map((r) => (
                <span key={r.id} style={{ marginLeft: -4 }}><Avatar name={r.name} size={20} title={`${r.name} (${r.role})`} /></span>
              ))}
            </div>
            {roster.length > 4 && <span>+{roster.length - 4}</span>}
          </span>
        </div>
      </div>

      <div className="play-canvas-wrap">
        <canvas
          ref={canvasRef}
          width={240}
          height={160}
          className="play-canvas"
        />
      </div>

      <Gamepad onPress={(b: GbaButton) => {
        const c = coreRef.current; if (!c) return;
        c.pressButton(b);
        if (roleRef.current === "controller") netRef.current?.send({ type: "input", frame: c.getFrame(), button: b, pressed: true });
      }} onRelease={(b: GbaButton) => {
        const c = coreRef.current; if (!c) return;
        c.releaseButton(b);
        if (roleRef.current === "controller") netRef.current?.send({ type: "input", frame: c.getFrame(), button: b, pressed: false });
      }} disabled={!isController} />

      {status === "needs-tap" && (
        <div className="start-overlay" data-testid="start-overlay">
          <div className="start-card">
            <div className="start-eyebrow">
              <span className="rom-chip" style={{ fontSize: 10 }}>{romName}</span>
              <span>#{saveId}</span>
            </div>
            <h1>{saveName}</h1>
            <div className={`role-pill${role === "follower" ? " follower" : ""}`} data-testid="role-pill">
              {role === "controller"
                ? "You're in control"
                : role === "follower"
                  ? "You're watching"
                  : "Joining…"}
            </div>
            {contributorEntries.length > 0 && (
              <div className="contrib-row">
                {contributorEntries.slice(0, 8).map(([n, ms]) => (
                  <span key={n} className="contributor-chip" title={`${n} contributed ${formatMs(ms)}`}>
                    <Avatar name={n} size={18} />
                    <span className="name">{n}</span>
                    <span className="time">{formatMs(ms)}</span>
                  </span>
                ))}
              </div>
            )}
            <p className="start-sub">
              Tap below to start. We need the tap to unlock audio and enter
              fullscreen on mobile.
            </p>
            <div className="actions">
              <button onClick={onTapStart} data-testid="tap-to-start" className="primary">
                Tap to start
              </button>
              <button onClick={onShare} data-testid="share-overlay" className="secondary">
                Share link
              </button>
            </div>
          </div>
        </div>
      )}

      {shareToast && <div className="share-toast" data-testid="share-toast">{shareToast}</div>}
    </div>
  );
}

// Serverless home / lobby (SPEC-SERVERLESS, reworked for per-owner configs).
//
// Config is NEVER baked into the build (that would let any visitor burn the
// owner's free Firebase quota). Instead:
//   - To HOST: you paste your own Firebase config here (kept on THIS device).
//   - You can create multiple games on your project and mint a single-use invite
//     link per game; the link carries your config so invitees can connect.
//   - To JOIN: open an invite link (which brings the host's config with it).
//   - "Your games" lists only sessions you created or were invited to — possibly
//     across several different owners' Firebase projects.

import { useEffect, useRef, useState } from "react";
import { navigate } from "../lib/router";
import { getBackend } from "../net/backend";
import { parseConfigText } from "../net/config";
import { getOwnConfig, setOwnConfig, clearOwnConfig, normalizeConfig, isUsableConfig } from "../net/configStore";
import type { FirebaseConfigLike } from "../net/adapter";
import { importRom } from "../lib/romStore";
import { listMySessions, rememberSession, forgetSession, type MySession } from "../lib/sessionStore";
import { getPlayerName, setPlayerName, formatRelTime } from "../lib/player";
import { gradientForName } from "../lib/gradient";

export function HomePage() {
  const [name, setName] = useState<string>(getPlayerName());
  const [mySessions, setMySessions] = useState<MySession[]>(listMySessions());
  const [ownConfig, setOwnConfigState] = useState<FirebaseConfigLike | null>(getOwnConfig());
  const [ownUid, setOwnUid] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState<boolean>(false);
  const [configDraft, setConfigDraft] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // If we can host, connect to our own project (cheap) so we can show our owner
  // device id and be ready to create games.
  useEffect(() => {
    if (!ownConfig) { setOwnUid(null); return; }
    let alive = true;
    getBackend(ownConfig).then((a) => { if (alive) setOwnUid(a.currentMemberId()); }).catch(() => {});
    return () => { alive = false; };
  }, [ownConfig]);

  const saveName = (n: string) => { setName(n); setPlayerName(n); };

  const saveConfig = () => {
    setErr(null);
    try {
      const cfg = normalizeConfig(parseConfigText(configDraft));
      if (!isUsableConfig(cfg)) throw new Error("Missing apiKey, databaseURL, or projectId.");
      setOwnConfig(cfg);
      setOwnConfigState(cfg);
      setShowConfig(false);
      setConfigDraft("");
    } catch (e: any) {
      setErr(`That config didn't parse: ${e?.message ?? e}. Paste the firebaseConfig object from your Firebase console.`);
    }
  };

  const onStartNewGame = () => {
    if (!name.trim()) { setErr("Enter your name first."); return; }
    if (!ownConfig) { setShowConfig(true); return; }
    setErr(null);
    fileRef.current?.click();
  };

  const onRomChosen = async (file: File) => {
    if (!ownConfig) return;
    setBusy("Setting up your game…");
    setErr(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const romHash = await importRom(file.name, bytes);
      const romName = file.name.replace(/\.(gba|gbc|gb)$/i, "");
      const adapter = await getBackend(ownConfig);
      const { sessionId } = await adapter.createSession({ romHash, romName, name: name.trim() });
      rememberSession({ sessionId, config: ownConfig, romName, romHash, role: "owner" });
      navigate(`/s/${sessionId}`);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setBusy(null);
    }
  };

  const onPasteInvite = () => {
    const link = window.prompt("Paste the invite link you were sent:");
    if (!link) return;
    const hashIdx = link.indexOf("#");
    const frag = hashIdx >= 0 ? link.slice(hashIdx + 1) : link;
    const qIdx = frag.indexOf("?");
    const params = new URLSearchParams(qIdx >= 0 ? frag.slice(qIdx + 1) : frag);
    const d = params.get("d");
    if (!d) { setErr("That doesn't look like a valid invite link."); return; }
    navigate(`/join?d=${d}`);
  };

  const removeConfig = () => {
    if (!window.confirm("Remove your hosting config from this device? Games you host will become unmanageable from here until you re-add it.")) return;
    clearOwnConfig();
    setOwnConfigState(null);
  };

  return (
    <div className="home" data-testid="home">
      <h1 style={{ marginBottom: 4 }}>Play-Together GBA</h1>
      <p style={{ color: "var(--fg-muted)", marginTop: 0 }}>
        Play your Game Boy Advance games together — everyone runs their own copy of the ROM, in sync.
        No accounts; the host brings a free Firebase project, invitees join by link.
      </p>

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="name">Your name</label>
        <input id="name" data-testid="home-name" placeholder="e.g. Robin" maxLength={32}
          value={name} onChange={(e) => saveName(e.target.value)} />
      </div>

      {err && <div className="error" data-testid="home-error" style={{ marginTop: 8 }}>{err}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button className="primary" data-testid="start-new-game" onClick={onStartNewGame} disabled={!!busy}>
          {busy ? busy : ownConfig ? "Start a new game" : "Set up hosting to start a game"}
        </button>
        <button data-testid="open-invite" onClick={onPasteInvite} disabled={!!busy}>Open an invite link</button>
      </div>
      <input ref={fileRef} type="file" accept=".gba,.gb,.gbc,application/octet-stream"
        data-testid="new-game-rom-input" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onRomChosen(f); }} />

      {mySessions.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3>Your games</h3>
          {mySessions.map((s) => (
            <div key={s.sessionId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: gradientForName(s.romName) }} aria-hidden />
              <button onClick={() => navigate(`/s/${s.sessionId}`)} data-testid="rejoin-session"
                style={{ flex: 1, textAlign: "left", background: "none", border: 0, color: "var(--fg)", cursor: "pointer" }}>
                <div style={{ fontWeight: 600 }}>{s.romName}</div>
                <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                  {s.role === "owner" ? "You host" : "Invited"} · {s.config.projectId} · played {formatRelTime(s.lastPlayed)}
                </div>
              </button>
              <button aria-label="Forget" onClick={() => { forgetSession(s.sessionId); setMySessions(listMySessions()); }}
                style={{ background: "none", border: 0, color: "var(--fg-muted)", cursor: "pointer" }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Hosting config */}
      <div style={{ marginTop: 28, borderTop: "1px solid #ffffff14", paddingTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Hosting</h3>
        {ownConfig ? (
          <div style={{ fontSize: 13, color: "var(--fg-muted)" }}>
            <div data-testid="own-config-project">Project: <code>{ownConfig.projectId}</code></div>
            {ownUid && <div style={{ marginTop: 4 }}>Your device ID (owner recovery — see README): <code data-testid="home-uid" style={{ fontSize: 11 }}>{ownUid}</code></div>}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button data-testid="edit-config" onClick={() => { setConfigDraft(JSON.stringify(ownConfig, null, 2)); setShowConfig(true); }}>Edit config</button>
              <button data-testid="remove-config" onClick={removeConfig}>Remove</button>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--fg-muted)" }}>
            <p style={{ marginTop: 0 }}>
              To host games, paste your own Firebase web config. It stays on this device and is never
              uploaded to the app — see the README for the free, 10-minute setup.
            </p>
            <button data-testid="add-config" onClick={() => setShowConfig(true)}>Add your Firebase config</button>
          </div>
        )}

        {showConfig && (
          <div style={{ marginTop: 12 }}>
            <textarea
              data-testid="config-input"
              placeholder={'Paste your firebaseConfig object, e.g.\n{\n  apiKey: "...",\n  databaseURL: "https://...firebasedatabase.app",\n  projectId: "..."\n}'}
              value={configDraft}
              onChange={(e) => setConfigDraft(e.target.value)}
              style={{ width: "100%", minHeight: 140, fontFamily: "ui-monospace, monospace", fontSize: 12, padding: 8, borderRadius: 8 }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="primary" data-testid="save-config" onClick={saveConfig}>Save config</button>
              <button onClick={() => { setShowConfig(false); setConfigDraft(""); setErr(null); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 16, fontSize: 11, color: "var(--fg-dim)" }}>
        Build {typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev"}
      </div>
    </div>
  );
}

// Home / Join screen — pick a ROM (and later, a session). For M1 this just
// launches the local emulator. M2+ adds session id and roster.

import { useEffect, useState } from "react";
import { listRoms, type RomMeta } from "../lib/api";
import { navigate } from "../lib/router";

function newSessionId(): string {
  // Short URL-safe random id. 8 chars from a 32-char alphabet.
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  let out = "";
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  for (let i = 0; i < arr.length; i++) out += alphabet[arr[i] % alphabet.length];
  return out;
}

export function HomePage() {
  const [roms, setRoms] = useState<RomMeta[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState<string>(() => localStorage.getItem("name") ?? "");

  useEffect(() => {
    listRoms()
      .then(setRoms)
      .catch((e) => setErr(e.message));
  }, []);

  const onPlay = (romId: string) => {
    if (name.trim()) localStorage.setItem("name", name.trim());
    const params = new URLSearchParams({ rom: romId });
    if (name.trim()) params.set("name", name.trim());
    navigate(`/play?${params.toString()}`);
  };

  const onStartSession = (romId: string) => {
    if (name.trim()) localStorage.setItem("name", name.trim());
    const sessionId = newSessionId();
    const params = new URLSearchParams({ rom: romId });
    if (name.trim()) params.set("name", name.trim());
    navigate(`/s/${sessionId}?${params.toString()}`);
  };

  const onJoinSession = (sessionInput: string) => {
    if (name.trim()) localStorage.setItem("name", name.trim());
    let target = sessionInput.trim();
    if (!target) return;
    if (target.startsWith("http")) {
      try { target = new URL(target).pathname + new URL(target).search; } catch { /* leave */ }
    }
    if (!target.startsWith("/s/")) target = `/s/${target.replace(/^\/+/, "")}`;
    navigate(target);
  };

  return (
    <div className="home">
      <h1>Watch-Together GBA</h1>
      <p style={{ color: "var(--muted)" }}>
        Pick a ROM to play locally. Once Milestone 2 lands, you'll be able to share a session URL with others.
      </p>

      {err && <div className="error">{err}</div>}

      <div className="field">
        <label htmlFor="name">Your name (optional)</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Robin"
        />
      </div>

      <h2 style={{ fontSize: 16, color: "var(--muted)", marginTop: 24 }}>ROMs</h2>
      {!roms && !err && <div>Loading…</div>}
      {roms && roms.length === 0 && (
        <div className="error">
          No ROMs found. Drop a `.gba` file into <code>/server/roms/</code> and reload.
        </div>
      )}
      {roms && roms.length > 0 && (
        <ul className="rom-list">
          {roms.map((r) => (
            <li key={r.id}>
              <div>
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                <div className="rom-meta">
                  {(r.size / 1024).toFixed(1)} KB · sha256:{r.hash.slice(0, 12)}…
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => onPlay(r.id)} title="Play locally with no session">Solo</button>
                <button onClick={() => onStartSession(r.id)} title="Create a session URL to share">Watch-Together</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ fontSize: 16, color: "var(--muted)", marginTop: 24 }}>Join existing session</h2>
      <div className="field">
        <label htmlFor="join-input">Paste a session URL or id</label>
        <input
          id="join-input"
          placeholder="e.g. /s/abc12345 or just abc12345"
          data-testid="join-input"
          onKeyDown={(e) => {
            if (e.key === "Enter") onJoinSession((e.target as HTMLInputElement).value);
          }}
        />
      </div>

      <p style={{ marginTop: 24, fontSize: 12, color: "var(--muted)" }}>
        Need diagnostics? See the{" "}
        <a href="/spike" style={{ color: "var(--accent)" }}>determinism spike</a>.
      </p>
    </div>
  );
}

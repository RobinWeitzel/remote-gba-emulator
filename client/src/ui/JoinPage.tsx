// Invite redemption (SPEC-SERVERLESS §6/§7). Route: #/join?d=<encoded payload>.
//
// The payload carries the OWNER'S Firebase config + sessionId + inviteId (see
// inviteCodec). We connect to that project (which may be a different owner's
// project than any you've used before), redeem the single-use invite atomically,
// store the membership + config locally, then forward to the session. Re-clicking
// your own already-redeemed link is idempotent.

import { useEffect, useState } from "react";
import { navigate, useRoute } from "../lib/router";
import { getBackend } from "../net/backend";
import { decodeInvite, type InvitePayload } from "../net/inviteCodec";
import { rememberSession } from "../lib/sessionStore";
import { getPlayerName, setPlayerName } from "../lib/player";

type Phase = "need-name" | "joining" | "error";

function parsePayload(raw: string | null): InvitePayload | null {
  if (!raw) return null;
  try { return decodeInvite(raw); } catch { return null; }
}

export function JoinPage() {
  const route = useRoute();
  const payload = parsePayload(route.search.get("d"));

  const [phase, setPhase] = useState<Phase>(getPlayerName().trim() ? "joining" : "need-name");
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState<string>(getPlayerName());

  useEffect(() => {
    if (phase !== "joining") return;
    if (!payload) { setErr("This invite link is invalid or incomplete."); setPhase("error"); return; }
    let cancelled = false;
    (async () => {
      try {
        const adapter = await getBackend(payload.config);
        await adapter.joinViaInvite({ sessionId: payload.sessionId, inviteId: payload.inviteId }, { name: getPlayerName().trim() || "Player" });
        const meta = await adapter.getSessionMeta(payload.sessionId);
        rememberSession({
          sessionId: payload.sessionId,
          config: payload.config,
          romName: meta?.romName ?? payload.romName ?? "Game",
          romHash: meta?.romHash ?? "",
          role: adapter.isOwner() ? "owner" : "member",
        });
        if (!cancelled) navigate(`/s/${payload.sessionId}`);
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.message ?? String(e));
        setPhase("error");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (phase === "need-name") {
    const ok = name.trim().length > 0;
    return (
      <div className="home" data-testid="join-need-name">
        <h1>You're invited!</h1>
        <p style={{ color: "var(--fg-muted)" }}>
          {payload?.romName ? <>Join <strong>{payload.romName}</strong>. </> : null}Pick a name to join.
        </p>
        <div className="field">
          <label htmlFor="jn">Your name</label>
          <input id="jn" data-testid="join-name" autoFocus maxLength={32} placeholder="e.g. Robin"
            value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && ok) { setPlayerName(name.trim()); setPhase("joining"); } }} />
        </div>
        <button className="primary" data-testid="join-continue" disabled={!ok}
          onClick={() => { setPlayerName(name.trim()); setPhase("joining"); }}>
          Join the game
        </button>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="home">
        <div className="error" data-testid="join-error">{err}</div>
        <button onClick={() => navigate("/")}>Back to home</button>
      </div>
    );
  }

  return (
    <div className="home" data-testid="join-joining">
      <h1>Joining…</h1>
      <p style={{ color: "var(--fg-muted)" }}>Connecting and redeeming your invite.</p>
    </div>
  );
}

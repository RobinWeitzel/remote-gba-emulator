import { useState } from "react";
import { Sheet, type SheetState, SegmentedControl, ActionSheet } from "./primitives";
import { Avatar } from "./Avatar";
import type { RosterEntry, Role } from "@gba/shared";
import { loadRom, saveRom, type ControlLayout } from "../lib/settings";
import { navigate } from "../lib/router";

interface Props {
  saveName: string;
  romName: string;
  romId: string;
  saveId: string;
  role: Role | null;
  connState: "connecting" | "open" | "closed";
  roster: RosterEntry[];
  selfId: string | null;
  multiplier: number;
  muted: boolean;
  isController: boolean;
  layoutPref: ControlLayout | null;
  effectiveLayout: ControlLayout;
  onExit: () => void;
  onCycleSpeed: () => void;
  onToggleMute: () => void;
  onLayoutChange: (v: ControlLayout | "auto") => void;
  onHandover: (toConnId: string) => void;
  // Serverless additions (SPEC-SERVERLESS §7/§11).
  selfUid?: string | null;
  isOwner?: boolean;
  controllerFree?: boolean;
  onTakeControl?: () => void;
  inviteUrl?: string | null;
  onMintInvite?: () => void;
  onEndGame?: () => void;
}

export function InGameSheet(props: Props) {
  const {
    saveName, romName, romId, saveId, role, connState, roster, selfId,
    multiplier, muted, isController, layoutPref,
    onExit, onCycleSpeed, onToggleMute, onLayoutChange, onHandover,
    selfUid, isOwner, controllerFree, onTakeControl, inviteUrl, onMintInvite, onEndGame,
  } = props;

  const [state, setState] = useState<SheetState>("peek");
  const [handoverFor, setHandoverFor] = useState<RosterEntry | null>(null);

  const peopleInSession = roster.length;
  const controller = roster.find((r) => r.role === "controller");
  const statusText =
    connState !== "open" ? "Reconnecting…"
    : controller && controller.id === selfId ? "You're playing"
    : controller ? `${controller.name} is playing`
    : "Waiting for a controller";

  const promoteLayoutDefault = () => {
    const cur = loadRom(romId);
    saveRom(romId, { ...cur, controlLayout: layoutPref ?? "auto" });
  };

  return (
    <>
      <Sheet
        state={state}
        onStateChange={setState}
        peekHeight={28}
        expandedHeight="78dvh"
        handle={
          <div
            className="app-sheet-handle ingame-handle"
            aria-label="Open in-game menu"
            role="button"
            onClick={() => setState(state === "peek" ? "expanded" : "peek")}
            data-testid="ingame-handle"
          />
        }
      >
        {state === "expanded" && (
          <div>
            {/* Status header — moved here from the old peek row */}
            <div className="exp-section exp-now-playing">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div className="name">{saveName}</div>
                  <div className="sub">{statusText} · {multiplier}× · {romName}</div>
                </div>
                <button className="exit" onClick={onExit} data-testid="exit-to-home">Exit</button>
              </div>
            </div>

            {/* Players */}
            <div className="exp-section">
              <h3>Players ({peopleInSession})</h3>
              {!isController && controllerFree && onTakeControl && (
                <button
                  onClick={onTakeControl}
                  data-testid="take-control"
                  style={{
                    background: "var(--accent)", color: "var(--accent-on)", border: 0,
                    borderRadius: "var(--r-md)", padding: "8px 14px", fontSize: 13,
                    fontWeight: 700, cursor: "pointer", marginBottom: 8,
                  }}
                >
                  Take control
                </button>
              )}
              {roster.map((r) => (
                <div className="exp-row" key={r.id}>
                  <Avatar name={r.name} size={26} />
                  <span className="label">{r.name}</span>
                  <span className="value">{r.role}</span>
                  {isController && r.id !== selfId && (
                    <button
                      onClick={() => setHandoverFor(r)}
                      data-testid="handover-target"
                      data-target-id={r.id}
                      style={{
                        background: "var(--accent)", color: "var(--accent-on)",
                        border: 0, borderRadius: "var(--r-md)", padding: "6px 10px",
                        fontSize: 12, cursor: "pointer",
                      }}
                    >
                      Hand over
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Invite & access (serverless) */}
            <div className="exp-section">
              <h3>Invite a player</h3>
              {isOwner ? (
                <>
                  <p style={{ color: "var(--fg-muted)", fontSize: 12, margin: "0 0 8px" }}>
                    Each invite link works once. Send a fresh one to each person.
                  </p>
                  <button
                    onClick={onMintInvite}
                    data-testid="mint-invite"
                    style={{
                      background: "var(--accent)", color: "var(--accent-on)", border: 0,
                      borderRadius: "var(--r-md)", padding: "8px 14px", fontSize: 13,
                      fontWeight: 700, cursor: "pointer",
                    }}
                  >
                    Create invite link
                  </button>
                  {inviteUrl && (
                    <div style={{ marginTop: 8 }}>
                      <input
                        readOnly
                        value={inviteUrl}
                        data-testid="invite-url"
                        onFocus={(e: any) => e.target.select()}
                        style={{ width: "100%", fontSize: 12, padding: 6, borderRadius: 6 }}
                      />
                      <div style={{ color: "var(--fg-muted)", fontSize: 11, marginTop: 4 }}>
                        Copied to clipboard — share it with one person.
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p style={{ color: "var(--fg-muted)", fontSize: 12, margin: 0 }}>
                  Only the person who started this game can invite others.
                </p>
              )}
            </div>

            {/* Your device ID — owner recovery (§7) */}
            {selfUid && (
              <div className="exp-section">
                <h3>Your device ID</h3>
                <p style={{ color: "var(--fg-muted)", fontSize: 12, margin: "0 0 8px" }}>
                  {isOwner
                    ? "If you ever lose owner access (e.g. you clear site data), add this ID back to meta/owners in the Firebase console. Keep it somewhere safe."
                    : "Your durable ID on this device. Shown for support/recovery."}
                </p>
                <input
                  readOnly
                  value={selfUid}
                  data-testid="self-uid"
                  onFocus={(e: any) => e.target.select()}
                  style={{ width: "100%", fontSize: 12, padding: 6, borderRadius: 6, fontFamily: "ui-monospace, monospace" }}
                />
              </div>
            )}

            {/* End game (owner) — delete the session to free Spark storage */}
            {isOwner && onEndGame && (
              <div className="exp-section">
                <button
                  onClick={onEndGame}
                  data-testid="end-game"
                  style={{
                    background: "transparent", color: "#e0533d", border: "1px solid #e0533d55",
                    borderRadius: "var(--r-md)", padding: "8px 14px", fontSize: 13, cursor: "pointer",
                  }}
                >
                  End game & delete for everyone
                </button>
              </div>
            )}

            {/* Controls */}
            <div className="exp-section">
              <h3>Controls</h3>
              <div className="exp-row" style={{ flexWrap: "wrap" }}>
                <span className="label">Layout</span>
                <SegmentedControl<ControlLayout | "auto">
                  options={[
                    { value: "auto", label: "Auto" },
                    { value: "flanking", label: "Side" },
                    { value: "overlay", label: "Overlay" },
                    { value: "stacked", label: "Stacked" },
                  ]}
                  value={layoutPref ?? "auto"}
                  onChange={onLayoutChange}
                  testId="ingame-layout"
                />
                <button className="exp-promote" onClick={promoteLayoutDefault} data-testid="promote-layout">
                  Save as default for this game
                </button>
              </div>
              <button
                className="exp-row tap"
                onClick={() => { navigate(`/edit-controls?scope=rom:${encodeURIComponent(romId)}`); }}
                data-testid="ingame-edit-buttons"
                style={{ width: "100%", border: 0, color: "var(--fg)", textAlign: "left" }}
              >
                <span className="label">Customize buttons for this game…</span>
                <span style={{ color: "var(--fg-dim)" }}>›</span>
              </button>
              <div className="exp-row">
                <span className="label">Speed</span>
                {isController ? (
                  <button
                    onClick={onCycleSpeed}
                    data-testid="ingame-speed-cycle"
                    style={{
                      background: multiplier > 1 ? "var(--accent)" : "var(--bg-3)",
                      color: multiplier > 1 ? "var(--accent-on)" : "var(--fg)",
                      border: 0, borderRadius: "var(--r-md)",
                      padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                    }}
                  >
                    {multiplier}× (tap to cycle)
                  </button>
                ) : (
                  <span className="value">{multiplier}×</span>
                )}
              </div>
            </div>

            {/* Audio */}
            <div className="exp-section">
              <h3>Audio</h3>
              <button
                className="exp-row tap"
                onClick={onToggleMute}
                data-testid="ingame-mute"
                style={{ border: 0, color: "var(--fg)", textAlign: "left", width: "100%" }}
              >
                <span className="label">Sound</span>
                <span className="value">{muted ? "Muted" : "On"}</span>
              </button>
            </div>

            {/* Per-game shortcut */}
            <div className="exp-section">
              <h3>Settings for this game</h3>
              <p style={{ color: "var(--fg-muted)", fontSize: 12, margin: "0 0 8px" }}>
                Applies to every save using {romName} on this device.
              </p>
              <button
                className="exp-row tap"
                onClick={() => { navigate("/settings/per-game"); }}
                style={{ border: 0, color: "var(--fg)", textAlign: "left", width: "100%" }}
                data-testid="ingame-per-game"
              >
                <span className="label">Open per-game settings</span>
                <span style={{ color: "var(--fg-dim)" }}>›</span>
              </button>
            </div>
          </div>
        )}
      </Sheet>

      <ActionSheet
        open={handoverFor !== null}
        title={`Hand controls to ${handoverFor?.name ?? ""}?`}
        items={handoverFor ? [
          { label: "Confirm", onSelect: () => onHandover(handoverFor.id), testId: "handover-confirm" },
        ] : []}
        onClose={() => setHandoverFor(null)}
      />
    </>
  );
}


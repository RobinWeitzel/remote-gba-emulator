import { useState } from "react";
import { Sheet, type SheetState, SegmentedControl, ActionSheet } from "./primitives";
import { Avatar } from "./Avatar";
import type { RosterEntry, Role } from "@gba/shared";
import { loadRom, saveRom, type ControlLayout } from "../lib/settings";

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
}

export function InGameSheet(props: Props) {
  const {
    saveName, romName, romId, saveId, role, connState, roster, selfId,
    multiplier, muted, isController, layoutPref,
    onExit, onCycleSpeed, onToggleMute, onLayoutChange, onHandover,
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
        peekHeight={56}
        expandedHeight="78dvh"
      >
        <PeekRow
          roster={roster}
          statusText={statusText}
          multiplier={multiplier}
          isController={isController}
          onCycleSpeed={onCycleSpeed}
          onExpand={() => setState("expanded")}
        />

        {state === "expanded" && (
          <div style={{ marginTop: 8 }}>
            {/* Now playing */}
            <div className="exp-section exp-now-playing">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div className="name">{saveName}</div>
                  <div className="sub">{romName} · #{saveId} · {role ?? "joining"} · {connState}</div>
                </div>
                <button className="exit" onClick={onExit} data-testid="exit-to-home">Exit</button>
              </div>
            </div>

            {/* Players */}
            <div className="exp-section">
              <h3>Players ({peopleInSession})</h3>
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
                onClick={() => { location.assign(`/edit-controls?scope=rom:${encodeURIComponent(romId)}`); }}
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
                onClick={() => { location.assign("/settings/per-game"); }}
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

function PeekRow({
  roster, statusText, multiplier, isController, onCycleSpeed, onExpand,
}: {
  roster: RosterEntry[];
  statusText: string;
  multiplier: number;
  isController: boolean;
  onCycleSpeed: () => void;
  onExpand: () => void;
}) {
  return (
    <div
      className="peek-row"
      onClick={onExpand}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onExpand(); }}
    >
      <div className="avs">
        {roster.slice(0, 4).map((r) => (
          <Avatar key={r.id} name={r.name} size={26} title={`${r.name} (${r.role})`} />
        ))}
        {roster.length > 4 && (
          <span style={{ alignSelf: "center", marginLeft: 4, fontSize: 11, color: "var(--fg-muted)" }}>
            +{roster.length - 4}
          </span>
        )}
      </div>
      <div className="status">
        <span className="dot" /> {statusText}
      </div>
      <button
        className="speed"
        data-active={multiplier > 1 || undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (isController) onCycleSpeed();
          else onExpand();
        }}
        data-testid="peek-speed"
      >
        {multiplier}×
      </button>
    </div>
  );
}

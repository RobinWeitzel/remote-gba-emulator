import { useState } from "react";
import { Modal } from "./primitives";

interface Props {
  onCommit: (playerName: string) => void;
}

// First-run onboarding. Only collects the player's name and explains the
// model. After commit, the home screen takes over — there the user can
// join an existing save or tap the + FAB to create a new one.
export function OnboardingModal({ onCommit }: Props) {
  const [step, setStep] = useState(0);
  const [playerName, setPlayerName] = useState("");

  const next = () => setStep((s) => Math.min(1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  const canStep0 = playerName.trim().length > 0;
  const isLastStep = step === 1;

  return (
    <Modal open>
      <div style={{ maxWidth: 520, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24, minHeight: "85dvh" }}>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 24 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{
              width: 8, height: 8, borderRadius: 99,
              background: i === step ? "var(--accent)" : "var(--bg-3)",
            }} />
          ))}
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {step === 0 && (
            <>
              <h1 style={{ fontSize: 28, marginBottom: 8 }}>What should we call you?</h1>
              <p style={{ color: "var(--fg-muted)", marginBottom: 24 }}>
                Your name shows other players who's playing and credits your time on each save. Stored on this device only.
              </p>
              <input
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="e.g. Robin"
                maxLength={32}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && canStep0) next(); }}
                style={{
                  background: "var(--bg-2)", color: "var(--fg)", border: 0,
                  borderRadius: "var(--r-md)", padding: "14px 16px", fontSize: 18,
                }}
                data-testid="onboard-name"
              />
            </>
          )}
          {step === 1 && (
            <>
              <h1 style={{ fontSize: 28, marginBottom: 8 }}>Here's how it works</h1>
              <ol style={{ paddingLeft: 18, lineHeight: 1.7, color: "var(--fg-muted)" }}>
                <li><b style={{ color: "var(--fg)" }}>Pick or start a save.</b> A save is a long-running game everyone can pick up.</li>
                <li><b style={{ color: "var(--fg)" }}>First in plays, others watch.</b> Close your tab and the next person can take over — the game waits.</li>
                <li><b style={{ color: "var(--fg)" }}>Time is credited.</b> Whoever holds the controls earns minutes on the save's contributor list.</li>
              </ol>
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
          {step > 0 && (
            <button
              onClick={back}
              style={{ flex: 1, padding: 14, borderRadius: "var(--r-md)", background: "var(--bg-2)", color: "var(--fg)", border: 0 }}
            >
              Back
            </button>
          )}
          {!isLastStep ? (
            <button
              onClick={next}
              disabled={!canStep0}
              style={{ flex: 2, padding: 14, borderRadius: "var(--r-md)", background: "var(--accent)", color: "var(--accent-on)", border: 0, fontWeight: 600 }}
              data-testid="onboard-next"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={() => onCommit(playerName.trim())}
              style={{ flex: 2, padding: 14, borderRadius: "var(--r-md)", background: "var(--accent)", color: "var(--accent-on)", border: 0, fontWeight: 600 }}
              data-testid="onboard-create"
            >
              Get started
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

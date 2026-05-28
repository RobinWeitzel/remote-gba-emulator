import { useEffect, useState } from "react";
import { navigate } from "../lib/router";
import { useGlobalSettings, type ControlLayout, type HapticsMode } from "../lib/settings";
import { getPlayerName, setPlayerName } from "../lib/player";
import { listSaves, unarchiveSave, renameSave, deleteSave } from "../lib/api";
import type { SaveSummary } from "@gba/shared";
import { Avatar } from "./Avatar";
import { Prompt, SegmentedControl, ActionSheet, type ActionItem } from "./primitives";
import { IconBack } from "./icons";

export function SettingsPage() {
  const { settings, patch, refresh } = useGlobalSettings();
  const [name, setName] = useState<string>(getPlayerName());
  const [editingName, setEditingName] = useState(false);
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [rowMenuFor, setRowMenuFor] = useState<SaveSummary | null>(null);
  const [renaming, setRenaming] = useState<SaveSummary | null>(null);

  const refreshSaves = () => listSaves().then(setSaves).catch(() => {});
  useEffect(() => { refreshSaves(); }, []);
  useEffect(() => {
    const onPop = () => refresh();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [refresh]);
  const archived = saves.filter((s) => s.archived);

  const commitName = (n: string) => {
    setPlayerName(n);
    setName(n);
    setEditingName(false);
  };

  return (
    <div className="settings-shell">
      <div className="settings-inner">
        <div className="settings-header">
          <button className="back" onClick={() => navigate("/")} aria-label="Back" data-testid="settings-back">
            <IconBack size={14} />
          </button>
          <h1>Settings</h1>
        </div>

        {/* ===== Player ===== */}
        <section className="settings-section">
          <h2>Player</h2>
          <button className="settings-row" onClick={() => setEditingName(true)} data-testid="row-player">
            <Avatar name={name || "?"} size={28} />
            <span className="label">{name || "Set your name"}</span>
            <span className="chevron">›</span>
          </button>
        </section>

        {/* ===== Defaults ===== */}
        <section className="settings-section">
          <h2>Defaults</h2>
          <div className="settings-row">
            <span className="label">Control layout</span>
            <span className="segmented-wrap">
              <SegmentedControl<ControlLayout | "auto">
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "flanking", label: "Side" },
                  { value: "overlay", label: "Overlay" },
                  { value: "stacked", label: "Stacked" },
                ]}
                value={settings.controlLayout}
                onChange={(v) => patch({ controlLayout: v })}
                testId="seg-control-layout"
              />
            </span>
          </div>
          <button
            className="settings-row"
            onClick={() => navigate("/edit-controls?scope=global")}
            data-testid="row-button-layout-default"
          >
            <span className="label">Default button layout</span>
            <span className="value">{settings.buttonLayout ? "Customized" : "Default"}</span>
            <span className="chevron">›</span>
          </button>
          <div className="settings-row">
            <span className="label">Haptics</span>
            <span className="segmented-wrap">
              <SegmentedControl<HapticsMode>
                options={[
                  { value: "off", label: "Off" },
                  { value: "light", label: "Light" },
                  { value: "strong", label: "Strong" },
                ]}
                value={settings.haptics}
                onChange={(v) => patch({ haptics: v })}
                testId="seg-haptics"
              />
            </span>
          </div>
          <button
            className="settings-row toggle"
            onClick={() => patch({ soundFeedback: !settings.soundFeedback })}
            data-testid="row-sound-feedback"
          >
            <span className="label">Sound feedback on tap</span>
            <span className="value">{settings.soundFeedback ? "On" : "Off"}</span>
          </button>
          <button
            className="settings-row"
            onClick={() => navigate("/settings/per-game")}
            data-testid="row-per-game"
          >
            <span className="label">Per-game customizations</span>
            <span className="chevron">›</span>
          </button>
        </section>

        {/* ===== Archived ===== */}
        <section className="settings-section">
          <h2>Archived saves ({archived.length})</h2>
          {archived.length === 0 ? (
            <div className="settings-row" style={{ color: "var(--fg-muted)" }}>None.</div>
          ) : archived.map((s) => (
            <button
              key={s.id}
              className="settings-row"
              onClick={() => setRowMenuFor(s)}
              data-testid={`archived-row-${s.id}`}
            >
              <span className="label">{s.name}</span>
              <span className="value">{s.romName}</span>
              <span className="chevron">›</span>
            </button>
          ))}
        </section>

        {/* ===== About ===== */}
        <section className="settings-section">
          <h2>About</h2>
          <a className="settings-row" href="/spike">
            <span className="label">Determinism spike</span>
            <span className="chevron">›</span>
          </a>
          <a
            className="settings-row"
            href={`https://github.com/RobinWeitzel/play-together-gba/commit/${__APP_VERSION__}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="label">Build</span>
            <span className="value">#{__APP_VERSION__}</span>
            <span className="chevron">›</span>
          </a>
        </section>
      </div>

      <Prompt
        open={editingName}
        title="Your name"
        description="Shown to other players and tracks your contribution to each save. Stored on this device."
        initialValue={name}
        placeholder="e.g. Robin"
        cta="Save"
        maxLength={32}
        onSubmit={commitName}
        onCancel={() => setEditingName(false)}
      />
      <ActionSheet
        open={rowMenuFor !== null}
        title={rowMenuFor?.name}
        items={rowMenuFor ? [
          { label: "Restore", onSelect: async () => { await unarchiveSave(rowMenuFor.id); refreshSaves(); }, testId: "act-restore" },
          { label: "Rename…", onSelect: () => setRenaming(rowMenuFor), testId: "act-rename" },
          {
            label: "Download save state…",
            onSelect: () => {
              const safeName = rowMenuFor.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 40) || "save";
              const a = document.createElement("a");
              a.href = `/api/saves/${encodeURIComponent(rowMenuFor.id)}/snapshot`;
              a.download = `${safeName}-${rowMenuFor.id}.state`;
              a.click();
            },
            testId: "act-download",
          },
          {
            label: "Delete forever",
            destructive: true,
            onSelect: async () => { await deleteSave(rowMenuFor.id); refreshSaves(); },
            testId: "act-delete",
          },
        ] : []}
        onClose={() => setRowMenuFor(null)}
      />
      <Prompt
        open={renaming !== null}
        title={`Rename "${renaming?.name ?? ""}"`}
        initialValue={renaming?.name ?? ""}
        cta="Save"
        onSubmit={async (v) => {
          if (renaming) await renameSave(renaming.id, v);
          setRenaming(null); refreshSaves();
        }}
        onCancel={() => setRenaming(null)}
      />
    </div>
  );
}

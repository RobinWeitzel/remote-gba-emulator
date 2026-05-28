// New home: avatar (left), install + gear (right), carousel of save cards,
// FAB to create, long-press for actions, onboarding modal for first run.

import { useEffect, useMemo, useState } from "react";
import {
  archiveSave, createSave, deleteSave, listRoms, listSaves,
  renameSave, unarchiveSave, type RomMeta,
} from "../lib/api";
import { navigate } from "../lib/router";
import {
  formatMs, formatRelTime, getPlayerName, setPlayerName,
} from "../lib/player";
import { gradientForName } from "../lib/gradient";
import type { SaveSummary } from "@gba/shared";
import { Avatar } from "./Avatar";
import { InstallButton } from "./InstallButton";
import { OnboardingModal } from "./OnboardingModal";
import {
  ActionSheet, type ActionItem, Carousel, FAB, Prompt, Sheet, type SheetState,
} from "./primitives";
import { useLongPress } from "./hooks/useLongPress";
import { IconSettings } from "./icons";

export function HomePage() {
  const [roms, setRoms] = useState<RomMeta[] | null>(null);
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [name, setName] = useState<string>(getPlayerName);
  const [editingName, setEditingName] = useState(false);
  const [newSaveSheet, setNewSaveSheet] = useState(false);
  const [newSaveName, setNewSaveName] = useState("");
  const [newSaveRom, setNewSaveRom] = useState("");
  const [creating, setCreating] = useState(false);
  const [rowMenuFor, setRowMenuFor] = useState<SaveSummary | null>(null);
  const [renaming, setRenaming] = useState<SaveSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listRoms().then((r) => {
      setRoms(r);
      if (!newSaveRom && r.length) setNewSaveRom(r[0].id);
    }).catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = () => listSaves().then((s) => { if (alive) setSaves(s); }).catch(() => {});
    tick();
    const iv = window.setInterval(tick, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const nameOk = name.trim().length > 0;
  const active = useMemo(
    () => saves
      .filter((s) => !s.archived)
      .sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || b.updatedAt - a.updatedAt),
    [saves],
  );

  const onCreate = async () => {
    if (!nameOk || !newSaveName.trim() || !newSaveRom) return;
    setCreating(true);
    try {
      const s = await createSave({ name: newSaveName.trim(), romId: newSaveRom });
      setNewSaveSheet(false);
      setNewSaveName("");
      navigate(`/s/${s.id}`);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setCreating(false);
    }
  };

  const refresh = () => listSaves().then(setSaves).catch(() => {});

  const onArchive = async (s: SaveSummary) => { await archiveSave(s.id); refresh(); };
  const onUnarchive = async (s: SaveSummary) => { await unarchiveSave(s.id); refresh(); };
  const onDelete = async (s: SaveSummary) => { await deleteSave(s.id); refresh(); };
  const onDownload = (s: SaveSummary) => {
    const safeName = s.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 40) || "save";
    const a = document.createElement("a");
    a.href = `/api/saves/${encodeURIComponent(s.id)}/snapshot`;
    a.download = `${safeName}-${s.id}.state`;
    a.click();
  };

  if (!nameOk) {
    return <OnboardingModal
      onCommit={(playerName) => {
        setPlayerName(playerName);
        setName(playerName);
      }}
    />;
  }

  return (
    <div className="home-v2">
      <div className="home-v2-topbar">
        <button
          className="avatar-btn"
          onClick={() => setEditingName(true)}
          aria-label="Edit your name"
          data-testid="topbar-avatar"
        >
          <Avatar name={name} size={32} />
        </button>
        <div className="spacer" />
        <InstallButton />
        <button
          className="gear"
          onClick={() => navigate("/settings")}
          aria-label="Settings"
          data-testid="topbar-gear"
        >
          <IconSettings size={16} />
        </button>
      </div>

      {err && <div className="alert-error" data-testid="home-error" style={{ margin: "0 16px 12px" }}>{err}</div>}

      <div className="home-v2-carousel-wrap">
        {active.length === 0 ? (
          <div style={{ padding: "0 16px" }}>
            <div className="save-card-v2 empty" data-testid="empty-state">
              Start your first save with the + button
            </div>
          </div>
        ) : (
          <Carousel ariaLabel="Your saves" testId="save-carousel">
            {active.map((s) => (
              <SaveCardLarge
                key={s.id}
                save={s}
                onOpen={() => navigate(`/s/${s.id}`)}
                onLongPress={() => setRowMenuFor(s)}
              />
            ))}
          </Carousel>
        )}
      </div>

      <div className="home-v2-footer">
        <a href="/spike">spike</a>
        <a
          href={`https://github.com/RobinWeitzel/play-together-gba/commit/${__APP_VERSION__}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Build commit"
          data-testid="build-sha"
        >
          #{__APP_VERSION__}
        </a>
      </div>

      <FAB ariaLabel="New save" onClick={() => setNewSaveSheet(true)} testId="fab-new-save">
        +
      </FAB>

      <Prompt
        open={editingName}
        title="Your name"
        description="Shown to other players and tracks your contribution."
        initialValue={name}
        maxLength={32}
        cta="Save"
        onSubmit={(v) => { setPlayerName(v); setName(v); setEditingName(false); }}
        onCancel={() => setEditingName(false)}
      />

      <NewSaveSheet
        open={newSaveSheet}
        roms={roms ?? []}
        saveName={newSaveName}
        romId={newSaveRom}
        creating={creating}
        onSaveNameChange={setNewSaveName}
        onRomChange={setNewSaveRom}
        onSubmit={onCreate}
        onCancel={() => setNewSaveSheet(false)}
      />

      <ActionSheet
        open={rowMenuFor !== null}
        title={rowMenuFor?.name}
        items={rowMenuFor ? saveActionItems({
          save: rowMenuFor,
          onPerGame: () => navigate(`/settings/per-game`),
          onRename: () => setRenaming(rowMenuFor),
          onDownload: () => onDownload(rowMenuFor),
          onArchive: () => onArchive(rowMenuFor),
          onUnarchive: () => onUnarchive(rowMenuFor),
          onDelete: () => onDelete(rowMenuFor),
        }) : []}
        onClose={() => setRowMenuFor(null)}
      />

      <Prompt
        open={renaming !== null}
        title={`Rename "${renaming?.name ?? ""}"`}
        initialValue={renaming?.name ?? ""}
        cta="Save"
        onSubmit={async (v) => {
          if (renaming) await renameSave(renaming.id, v);
          setRenaming(null); refresh();
        }}
        onCancel={() => setRenaming(null)}
      />
    </div>
  );
}

function saveActionItems(args: {
  save: SaveSummary;
  onPerGame: () => void;
  onRename: () => void;
  onDownload: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}): ActionItem[] {
  const items: ActionItem[] = [
    { label: "Settings for this game", trailing: "chevron", onSelect: args.onPerGame, testId: "act-per-game" },
    { label: "Rename…", onSelect: args.onRename, testId: "act-rename" },
    { label: "Download save state…", onSelect: args.onDownload, testId: "act-download" },
  ];
  if (args.save.archived) {
    items.push({ label: "Restore", onSelect: args.onUnarchive, testId: "act-restore" });
    items.push({ label: "Delete forever", destructive: true, onSelect: args.onDelete, testId: "act-delete" });
  } else {
    items.push({ label: "Archive", onSelect: args.onArchive, testId: "act-archive" });
  }
  return items;
}

function SaveCardLarge({
  save, onOpen, onLongPress,
}: {
  save: SaveSummary;
  onOpen: () => void;
  onLongPress: () => void;
}) {
  const lp = useLongPress(onLongPress, 500);
  const bg = gradientForName(save.name);
  const contributors = Object.entries(save.contributors).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return (
    <div
      className="save-card-v2"
      style={{ background: bg }}
      data-save-id={save.id}
      onPointerDown={lp.onPointerDown as any}
      onPointerUp={lp.onPointerUp as any}
      onPointerCancel={lp.onPointerCancel as any}
      onPointerLeave={lp.onPointerLeave as any}
    >
      <div className="rom-chip">{save.romName}</div>
      <div className="title">{save.name}</div>
      <div className="meta">
        {save.live ? (
          save.live.controllerName ? <><strong>{save.live.controllerName}</strong> is playing</> : <>Waiting for a controller</>
        ) : (
          <>Last played {formatRelTime(save.updatedAt)}</>
        )}
      </div>
      {save.live && <div className="live-row"><div className="dot" /> LIVE · {save.live.participantCount} {save.live.participantCount === 1 ? "person" : "people"} in session</div>}
      {contributors.length > 0 && (
        <div className="contribs">
          {contributors.map(([n, ms]) => (
            <span key={n} className="chip" title={`${n}: ${formatMs(ms)}`}>
              <Avatar name={n} size={20} />
              <span>{n}</span>
              <span style={{ color: "var(--fg-dim)" }}>· {formatMs(ms)}</span>
            </span>
          ))}
        </div>
      )}
      <button className="play-cta" onClick={onOpen} data-testid="play-cta">
        {save.live ? "Join" : "Continue"} ▶
      </button>
    </div>
  );
}

function NewSaveSheet({
  open, roms, saveName, romId, creating,
  onSaveNameChange, onRomChange, onSubmit, onCancel,
}: {
  open: boolean;
  roms: RomMeta[];
  saveName: string;
  romId: string;
  creating: boolean;
  onSaveNameChange: (v: string) => void;
  onRomChange: (id: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const state: SheetState = open ? "expanded" : "closed";
  const ok = saveName.trim().length > 0 && romId.length > 0 && !creating;
  return (
    <Sheet state={state} onStateChange={(n) => { if (n !== "expanded") onCancel(); }} expandedHeight="auto">
      <div className="app-prompt">
        <h3>New save</h3>
        <p>Saves are long-running games anyone on this server can play.</p>
        <input
          value={saveName}
          onChange={(e) => onSaveNameChange(e.target.value)}
          placeholder="Save name, e.g. Family Emerald"
          maxLength={64}
          data-testid="new-save-name"
        />
        <select
          value={romId}
          onChange={(e) => onRomChange(e.target.value)}
          data-testid="new-save-rom"
          style={{
            background: "var(--bg-3)", color: "var(--fg)",
            border: 0, borderRadius: "var(--r-md)", padding: "12px 14px",
            fontSize: 16,
          }}
        >
          {roms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <div className="actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={onSubmit} disabled={!ok} data-testid="create-save">
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

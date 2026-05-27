// Home / landing screen.
//
// Layout:
//   • Hero with brand + player pill (or onboarding card when name unset).
//   • "Your saves" — active (un-archived) saves; primary surface.
//   • "Start a new save" — inline form.
//   • Collapsible "Archived (N)" section at the bottom (hidden by default).
//
// Saves can be archived (soft-deleted) and restored. They're still on disk
// either way; archived ones simply don't appear in the active list.

import { useEffect, useMemo, useState } from "react";
import {
  archiveSave,
  createSave,
  deleteSave,
  listRoms,
  listSaves,
  renameSave,
  unarchiveSave,
  type RomMeta,
} from "../lib/api";
import { navigate } from "../lib/router";
import {
  formatMs,
  formatRelTime,
  getPlayerName,
  setPlayerName,
} from "../lib/player";
import type { SaveSummary } from "@gba/shared";
import { Avatar } from "./Avatar";
import { InstallButton } from "./InstallButton";
import {
  IconBookmark,
  IconGamepad,
  IconPlay,
  IconPlus,
  IconUsers,
} from "./icons";

export function HomePage() {
  const [roms, setRoms] = useState<RomMeta[] | null>(null);
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState<string>(getPlayerName);
  const [nameDraft, setNameDraft] = useState<string>("");
  const [editingName, setEditingName] = useState<boolean>(false);
  const [newSaveName, setNewSaveName] = useState<string>("");
  const [newSaveRomId, setNewSaveRomId] = useState<string>("");
  const [creating, setCreating] = useState<boolean>(false);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    listRoms()
      .then((r) => {
        setRoms(r);
        if (!newSaveRomId && r.length > 0) setNewSaveRomId(r[0].id);
      })
      .catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      listSaves()
        .then((s) => { if (alive) setSaves(s); })
        .catch(() => { /* silent */ });
    };
    tick();
    const iv = window.setInterval(tick, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // Click-outside closes any open card menu.
  useEffect(() => {
    if (!openMenuId) return;
    const onDoc = (e: Event) => {
      const t = e.target as HTMLElement;
      if (!t.closest?.("[data-card-menu]")) setOpenMenuId(null);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [openMenuId]);

  const nameOk = name.trim().length > 0;

  const commitName = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setPlayerName(trimmed);
    setName(trimmed);
    setEditingName(false);
  };

  const goToSave = (save: SaveSummary) => {
    if (!nameOk) return;
    navigate(`/s/${save.id}`);
  };

  const onCreateSave = async () => {
    setErr(null);
    if (!nameOk) { setErr("Enter your player name first."); return; }
    if (!newSaveName.trim()) { setErr("Give the new save a name (e.g. 'Family Emerald run')."); return; }
    if (!newSaveRomId) { setErr("Pick a ROM."); return; }
    setCreating(true);
    try {
      const save = await createSave({ name: newSaveName.trim(), romId: newSaveRomId });
      setNewSaveName("");
      navigate(`/s/${save.id}`);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setCreating(false);
    }
  };

  const onArchive = async (save: SaveSummary) => {
    setOpenMenuId(null);
    const ok = window.confirm(
      `Archive "${save.name}"?\n\n` +
        `It will move to the "Archived" section and stop appearing in the main list. ` +
        `The save state and contributors stay on disk and can be restored later.`,
    );
    if (!ok) return;
    setBusyId(save.id);
    try {
      const updated = await archiveSave(save.id);
      setSaves((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  };

  const onUnarchive = async (save: SaveSummary) => {
    setOpenMenuId(null);
    const ok = window.confirm(`Restore "${save.name}" to the main list?`);
    if (!ok) return;
    setBusyId(save.id);
    try {
      const updated = await unarchiveSave(save.id);
      setSaves((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  };

  const onDownload = (save: SaveSummary) => {
    setOpenMenuId(null);
    // Sanitise the user-supplied save name for a filesystem-friendly
    // filename (the save id keeps it unambiguous if two saves share a
    // name).
    const safeName = save.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 40) || "save";
    const filename = `${safeName}-${save.id}.state`;
    const a = document.createElement("a");
    a.href = `/api/saves/${encodeURIComponent(save.id)}/snapshot`;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const onRename = async (save: SaveSummary) => {
    setOpenMenuId(null);
    const raw = window.prompt(`Rename "${save.name}":`, save.name);
    if (raw === null) return;
    const next = raw.trim().slice(0, 64);
    if (!next || next === save.name) return;
    setBusyId(save.id);
    try {
      const updated = await renameSave(save.id, next);
      setSaves((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (save: SaveSummary) => {
    setOpenMenuId(null);
    const ok = window.confirm(
      `Delete "${save.name}" forever?\n\n` +
        `The save state, contributor history, and everything on disk will be ` +
        `permanently removed. This cannot be undone.`,
    );
    if (!ok) return;
    setBusyId(save.id);
    try {
      await deleteSave(save.id);
      setSaves((prev) => prev.filter((s) => s.id !== save.id));
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  };

  const { active, archived } = useMemo(() => {
    const sorter = (a: SaveSummary, b: SaveSummary) => {
      const aLive = a.live ? 1 : 0;
      const bLive = b.live ? 1 : 0;
      if (aLive !== bLive) return bLive - aLive;
      return b.updatedAt - a.updatedAt;
    };
    const active = saves.filter((s) => !s.archived).sort(sorter);
    const archived = saves.filter((s) => s.archived).sort((a, b) => b.updatedAt - a.updatedAt);
    return { active, archived };
  }, [saves]);

  return (
    <div className="home-shell">
      <div className="home-inner">
        {/* ===== Hero ===== */}
        <div className="home-hero">
          <div className="home-brand">
            <div className="brand-mark"><IconGamepad size={22} /></div>
            <div>
              <h1>Play-Together GBA</h1>
              <p className="tagline">Shared GBA saves for your family run.</p>
            </div>
          </div>
          <div className="home-hero-actions">
            <InstallButton />
            {nameOk && !editingName && (
              <button
                className="player-pill"
                onClick={() => { setNameDraft(name); setEditingName(true); }}
                data-testid="player-pill"
                title="Click to change your name"
              >
                <Avatar name={name} size={26} />
                <span>{name}</span>
                <span className="change">change</span>
              </button>
            )}
          </div>
        </div>

        {err && <div className="alert-error" data-testid="home-error">{err}</div>}

        {/* ===== Onboarding ===== */}
        {!nameOk && (
          <div className="onboard-card" data-testid="onboard-card">
            <h2>Pick a name to get started</h2>
            <p className="lead">
              We use your name to show who's playing and to credit your time
              on each save. It's stored on this device only — no signup, no
              accounts.
            </p>
            <NameForm initialValue="" onSubmit={commitName} cta="Continue" />
          </div>
        )}

        {nameOk && editingName && (
          <div className="onboard-card" data-testid="onboard-card">
            <h2>Change your name</h2>
            <p className="lead">
              New playtime will be credited to the new name. Old contributions
              stay attached to the previous name.
            </p>
            <NameForm
              initialValue={nameDraft}
              onSubmit={commitName}
              onCancel={() => setEditingName(false)}
              cta="Save"
            />
          </div>
        )}

        {/* ===== How it works (first-time + when empty) ===== */}
        {(!nameOk || active.length === 0) && (
          <div className="how-it-works">
            <div className="hiw-card">
              <span className="num">1</span>
              <div className="body">
                <strong>Pick or start a save.</strong> A save is a long-running
                game everyone in the family can pick up.
              </div>
            </div>
            <div className="hiw-card">
              <span className="num">2</span>
              <div className="body">
                <strong>First in plays, others watch.</strong> Close your tab
                and the next person can take over — the game waits.
              </div>
            </div>
            <div className="hiw-card">
              <span className="num">3</span>
              <div className="body">
                <strong>Time is credited.</strong> Whoever holds the controls
                earns minutes on the save's contributor list.
              </div>
            </div>
          </div>
        )}

        {/* ===== Active saves ===== */}
        <div className="section-head">
          <h2>
            <IconBookmark size={11} style={{ marginRight: 6, verticalAlign: -1 }} />
            Your saves
          </h2>
          {active.length > 0 && <span className="count">{active.length}</span>}
        </div>

        {active.length === 0 ? (
          <div className="empty-state" data-testid="empty-saves">
            <div className="em-icon"><IconBookmark size={20} /></div>
            <div>No saves yet. <strong>Start one below</strong> — anyone who
              can reach this server will see it here and can hop in.</div>
          </div>
        ) : (
          <ul className="save-list" data-testid="save-list">
            {active.map((s) => (
              <SaveCard
                key={s.id}
                save={s}
                nameOk={nameOk}
                busy={busyId === s.id}
                menuOpen={openMenuId === s.id}
                onOpenMenu={() => setOpenMenuId(openMenuId === s.id ? null : s.id)}
                onOpenSave={() => goToSave(s)}
                onArchive={() => onArchive(s)}
                onRename={() => onRename(s)}
                onDownload={() => onDownload(s)}
              />
            ))}
          </ul>
        )}

        {/* ===== New save ===== */}
        <div className="section-head">
          <h2>
            <IconPlus size={11} style={{ marginRight: 6, verticalAlign: -1 }} />
            Start a new save
          </h2>
        </div>

        {!roms && !err && <div className="empty-state">Loading ROMs…</div>}
        {roms && roms.length === 0 && (
          <div className="alert-error">
            No ROMs found. Drop a <code>.gba</code> file into the mounted{" "}
            <code>/app/server/roms</code> volume and restart the container.
          </div>
        )}
        {roms && roms.length > 0 && (
          <div className="new-save-card">
            <div className="field">
              <label>Save name</label>
              <input
                value={newSaveName}
                onChange={(e) => setNewSaveName(e.target.value)}
                placeholder="e.g. Family Emerald run"
                data-testid="new-save-name"
                autoComplete="off"
                maxLength={64}
              />
            </div>
            <div className="field">
              <label>ROM</label>
              <select
                value={newSaveRomId}
                onChange={(e) => setNewSaveRomId(e.target.value)}
                data-testid="new-save-rom"
              >
                {roms.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <button
              onClick={onCreateSave}
              disabled={creating || !nameOk || !newSaveName.trim() || !newSaveRomId}
              data-testid="create-save"
              title={!nameOk ? "Pick a name first" : undefined}
            >
              {creating ? "Creating…" : "Create save"}
            </button>
          </div>
        )}

        {/* ===== Archived ===== */}
        {archived.length > 0 && (
          <>
            <div className="section-head" style={{ marginTop: 28 }}>
              <button
                className="archived-toggle"
                onClick={() => setShowArchived((v) => !v)}
                data-testid="toggle-archived"
              >
                <span style={{ marginRight: 6 }}>{showArchived ? "▾" : "▸"}</span>
                Archived
                <span className="count" style={{ marginLeft: 6 }}>{archived.length}</span>
              </button>
            </div>
            {showArchived && (
              <ul className="save-list save-list-archived" data-testid="archived-save-list">
                {archived.map((s) => (
                  <SaveCard
                    key={s.id}
                    save={s}
                    nameOk={nameOk}
                    busy={busyId === s.id}
                    menuOpen={openMenuId === s.id}
                    onOpenMenu={() => setOpenMenuId(openMenuId === s.id ? null : s.id)}
                    onOpenSave={() => goToSave(s)}
                    onRename={() => onRename(s)}
                onDownload={() => onDownload(s)}
                    onUnarchive={() => onUnarchive(s)}
                    onDelete={() => onDelete(s)}
                  />
                ))}
              </ul>
            )}
          </>
        )}

        <div className="home-footer">
          <a href="/spike">Determinism spike</a>
          <span>·</span>
          <span>v2 · persistent saves</span>
          <span>·</span>
          <span title="Build commit" data-testid="build-sha">#{__APP_VERSION__}</span>
        </div>
      </div>
    </div>
  );
}

/* ----- Sub-components ----- */

interface SaveCardProps {
  save: SaveSummary;
  nameOk: boolean;
  busy: boolean;
  menuOpen: boolean;
  onOpenMenu: () => void;
  onOpenSave: () => void;
  onRename?: () => void;
  onDownload?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onDelete?: () => void;
}

function SaveCard({
  save,
  nameOk,
  busy,
  menuOpen,
  onOpenMenu,
  onOpenSave,
  onRename,
  onDownload,
  onArchive,
  onUnarchive,
  onDelete,
}: SaveCardProps) {
  const contributors = Object.entries(save.contributors).sort((a, b) => b[1] - a[1]);
  return (
    <li
      className={`save-card${save.live ? " live" : ""}${save.archived ? " archived" : ""}`}
      data-save-id={save.id}
    >
      <div className="save-main">
        <div className="save-title-row">
          <span className="save-name">{save.name}</span>
          <span className="rom-chip">{save.romName}</span>
          {save.live && <span className="live-pill">LIVE</span>}
        </div>
        <div className="save-meta">
          {save.live ? (
            <>
              {save.live.controllerName
                ? <><strong>{save.live.controllerName}</strong> is playing</>
                : <>Waiting for a controller</>}
              {" · "}
              {save.live.participantCount} {save.live.participantCount === 1 ? "person" : "people"} in session
            </>
          ) : (
            <>Last played {formatRelTime(save.updatedAt)}</>
          )}
        </div>
        {contributors.length > 0 && (
          <div className="contributors" data-testid="contributors">
            {contributors.slice(0, 6).map(([n, ms]) => (
              <span key={n} className="contributor-chip" title={`${n}: ${formatMs(ms)}`}>
                <Avatar name={n} size={20} />
                <span className="name">{n}</span>
                <span className="time">{formatMs(ms)}</span>
              </span>
            ))}
            {contributors.length > 6 && (
              <span className="contributor-chip">+{contributors.length - 6}</span>
            )}
          </div>
        )}
      </div>

      <div className="save-card-actions">
        <button
          className="open-btn"
          onClick={onOpenSave}
          disabled={!nameOk || busy}
          data-testid="open-save"
          title={!nameOk ? "Pick a name first" : undefined}
        >
          {save.live
            ? <>Join <IconUsers size={14} style={{ verticalAlign: -2, marginLeft: 4 }} /></>
            : save.archived
              ? <>Open</>
              : <>Continue <IconPlay size={12} style={{ verticalAlign: -1, marginLeft: 4 }} /></>}
        </button>
        <div className="save-menu-wrap" data-card-menu>
          <button
            className="save-menu-btn"
            onClick={onOpenMenu}
            data-testid="save-menu-btn"
            aria-label="More actions"
            aria-expanded={menuOpen}
          >⋯</button>
          {menuOpen && (
            <div className="save-menu" role="menu">
              {onRename && (
                <button
                  className="save-menu-item"
                  onClick={onRename}
                  data-testid="action-rename"
                  disabled={busy}
                >
                  Rename…
                </button>
              )}
              {onDownload && (
                <button
                  className="save-menu-item"
                  onClick={onDownload}
                  data-testid="action-download"
                  disabled={busy}
                >
                  Download save…
                </button>
              )}
              {onArchive && (
                <button
                  className="save-menu-item"
                  onClick={onArchive}
                  data-testid="action-archive"
                  disabled={busy}
                >
                  Archive…
                </button>
              )}
              {onUnarchive && (
                <button
                  className="save-menu-item"
                  onClick={onUnarchive}
                  data-testid="action-unarchive"
                  disabled={busy}
                >
                  Restore…
                </button>
              )}
              {onDelete && (
                <button
                  className="save-menu-item save-menu-item-danger"
                  onClick={onDelete}
                  data-testid="action-delete"
                  disabled={busy}
                >
                  Delete forever…
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function NameForm({
  initialValue,
  onSubmit,
  onCancel,
  cta,
}: {
  initialValue: string;
  onSubmit: (v: string) => void;
  onCancel?: () => void;
  cta: string;
}) {
  const [value, setValue] = useState<string>(initialValue);
  const ok = value.trim().length > 0;
  return (
    <div className="input-row">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && ok) onSubmit(value); }}
        placeholder="Your name (e.g. Robin)"
        data-testid="name-input"
        autoFocus
        autoComplete="off"
        maxLength={32}
      />
      {onCancel && (
        <button onClick={onCancel} style={{ background: "var(--bg-elev-2)" }}>Cancel</button>
      )}
      <button onClick={() => onSubmit(value)} disabled={!ok}>{cta}</button>
    </div>
  );
}

// Home / landing screen.
//
// Three states:
//   1. First-time (no player name yet) → focused onboarding card prompting
//      for the name, plus a three-card "how it works" strip.
//   2. Returning user (name set) → header with player chip, then "Pick up
//      a save" list, then "Start something new" card, then join-by-link.
//   3. Empty server (no saves yet) → onboarding card + a clear empty state
//      that explains the first save can be created below.

import { useEffect, useMemo, useState } from "react";
import { createSave, listRoms, listSaves, type RomMeta } from "../lib/api";
import { navigate } from "../lib/router";
import {
  formatMs,
  formatRelTime,
  getPlayerName,
  setPlayerName,
} from "../lib/player";
import type { SaveSummary } from "@gba/shared";
import { Avatar } from "./Avatar";
import {
  IconBookmark,
  IconGamepad,
  IconPlay,
  IconPlus,
  IconShare,
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
  const [joinInput, setJoinInput] = useState<string>("");

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
        .catch(() => { /* silent; server might restart */ });
    };
    tick();
    const iv = window.setInterval(tick, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

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

  const onJoinFromInput = () => {
    let target = joinInput.trim();
    if (!target) return;
    if (target.startsWith("http")) {
      try {
        const u = new URL(target);
        target = u.pathname + u.search;
      } catch { /* keep raw */ }
    }
    if (!target.startsWith("/s/")) target = `/s/${target.replace(/^\/+/, "")}`;
    navigate(target);
  };

  const orderedSaves = useMemo(() => {
    return [...saves].sort((a, b) => {
      const aLive = a.live ? 1 : 0;
      const bLive = b.live ? 1 : 0;
      if (aLive !== bLive) return bLive - aLive;
      return b.updatedAt - a.updatedAt;
    });
  }, [saves]);

  return (
    <div className="home-shell">
      <div className="home-inner">
        {/* ===== Hero ===== */}
        <div className="home-hero">
          <div className="home-brand">
            <div className="brand-mark"><IconGamepad size={22} /></div>
            <div>
              <h1>Watch-Together GBA</h1>
              <p className="tagline">Shared GBA saves for your family run.</p>
            </div>
          </div>
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

        {err && <div className="alert-error" data-testid="home-error">{err}</div>}

        {/* ===== Onboarding (no name yet) ===== */}
        {!nameOk && (
          <div className="onboard-card" data-testid="onboard-card">
            <h2>Pick a name to get started</h2>
            <p className="lead">
              We use your name to show who's playing and to credit your time
              on each save. It's stored on this device only — no signup, no
              accounts.
            </p>
            <NameForm
              initialValue=""
              onSubmit={commitName}
              cta="Continue"
            />
          </div>
        )}

        {/* Name edit inline (name set, but user clicked "change") */}
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
        {(!nameOk || saves.length === 0) && (
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

        {/* ===== Saves list ===== */}
        <div className="section-head">
          <h2>
            <IconBookmark size={11} style={{ marginRight: 6, verticalAlign: "-1px" } as any} />
            Your saves
          </h2>
          {orderedSaves.length > 0 && <span className="count">{orderedSaves.length}</span>}
        </div>

        {orderedSaves.length === 0 ? (
          <div className="empty-state" data-testid="empty-saves">
            <div className="em-icon"><IconBookmark size={20} /></div>
            <div>No saves yet. <strong>Start one below</strong> — anyone who
              can reach this server will see it here and can hop in.</div>
          </div>
        ) : (
          <ul className="save-list" data-testid="save-list">
            {orderedSaves.map((s) => {
              const contributors = Object.entries(s.contributors)
                .sort((a, b) => b[1] - a[1]);
              return (
                <li
                  key={s.id}
                  className={`save-card${s.live ? " live" : ""}`}
                  data-save-id={s.id}
                >
                  <div className="save-main">
                    <div className="save-title-row">
                      <span className="save-name">{s.name}</span>
                      <span className="rom-chip">{s.romName}</span>
                      {s.live && <span className="live-pill">LIVE</span>}
                    </div>
                    <div className="save-meta">
                      {s.live ? (
                        <>
                          {s.live.controllerName
                            ? <><strong>{s.live.controllerName}</strong> is playing</>
                            : <>Waiting for a controller</>}
                          {" · "}
                          {s.live.participantCount} {s.live.participantCount === 1 ? "person" : "people"} in session
                        </>
                      ) : (
                        <>Last played {formatRelTime(s.updatedAt)}</>
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
                  <button
                    className="open-btn"
                    onClick={() => goToSave(s)}
                    disabled={!nameOk}
                    data-testid="open-save"
                    title={!nameOk ? "Pick a name first" : undefined}
                  >
                    {s.live ? (<>Join <IconUsers size={14} style={{ verticalAlign: -2, marginLeft: 4 } as any} /></>) : (<>Continue <IconPlay size={12} style={{ verticalAlign: -1, marginLeft: 4 } as any} /></>)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* ===== New save ===== */}
        <div className="section-head">
          <h2>
            <IconPlus size={11} style={{ marginRight: 6, verticalAlign: "-1px" } as any} />
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

        {/* ===== Join by link or id ===== */}
        <div className="section-head">
          <h2>
            <IconShare size={11} style={{ marginRight: 6, verticalAlign: "-1px" } as any} />
            Got a link?
          </h2>
        </div>
        <div className="join-by-input">
          <input
            value={joinInput}
            onChange={(e) => setJoinInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onJoinFromInput(); }}
            placeholder="https://…/s/abc12345 or just abc12345"
            data-testid="join-input"
          />
          <button onClick={onJoinFromInput}>Join</button>
        </div>

        <div className="home-footer">
          <a href="/spike">Determinism spike</a>
          <span>·</span>
          <span>v2 · persistent saves</span>
        </div>
      </div>
    </div>
  );
}

/* ----- Sub-components ----- */

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
      />
      {onCancel && (
        <button onClick={onCancel} style={{ background: "var(--bg-elev-2)" }}>Cancel</button>
      )}
      <button onClick={() => onSubmit(value)} disabled={!ok}>{cta}</button>
    </div>
  );
}

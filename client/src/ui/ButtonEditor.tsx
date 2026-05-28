import { useEffect, useMemo, useRef, useState } from "react";
import { navigate, useRoute } from "../lib/router";
import {
  loadGlobal, saveGlobal, loadRom, saveRom,
  useOrientation,
  type ButtonLayout, type OrientationLayout, type ButtonId,
} from "../lib/settings";
import {
  DEFAULT_BUTTON_LAYOUT, DEFAULT_PORTRAIT, DEFAULT_LANDSCAPE, deepClone,
  clampToSafeArea,
} from "../lib/buttonLayout";
import { useSafeArea } from "./hooks/useSafeArea";
import { listRoms, type RomMeta } from "../lib/api";
import { SegmentedControl, Slider } from "./primitives";

type Scope = { kind: "global" } | { kind: "rom"; romId: string };

function readScope(search: URLSearchParams): Scope {
  const raw = search.get("scope") ?? "global";
  if (raw.startsWith("rom:")) return { kind: "rom", romId: decodeURIComponent(raw.slice(4)) };
  return { kind: "global" };
}

function loadScopeLayout(scope: Scope): ButtonLayout {
  if (scope.kind === "global") {
    const g = loadGlobal();
    return g.buttonLayout ? deepClone(g.buttonLayout) : deepClone(DEFAULT_BUTTON_LAYOUT);
  }
  const r = loadRom(scope.romId);
  if (r.buttonLayout) return deepClone(r.buttonLayout);
  const g = loadGlobal();
  return g.buttonLayout ? deepClone(g.buttonLayout) : deepClone(DEFAULT_BUTTON_LAYOUT);
}

export function ButtonEditor() {
  const route = useRoute();
  const scope = useMemo(() => readScope(route.search), [route.search]);

  const isLandscape = useOrientation();
  const [orientation, setOrientation] = useState<"portrait" | "landscape">(
    isLandscape ? "landscape" : "portrait",
  );

  const [layout, setLayout] = useState<ButtonLayout>(() => loadScopeLayout(scope));
  const [selected, setSelected] = useState<ButtonId | null>(null);
  const [gridSnap, setGridSnap] = useState(false);
  const [roms, setRoms] = useState<RomMeta[]>([]);

  useEffect(() => { listRoms().then(setRoms).catch(() => {}); }, []);
  const romName = scope.kind === "rom"
    ? (roms.find((r) => r.id === scope.romId)?.name ?? scope.romId)
    : "Default layout";

  const current = layout.orientations[orientation];

  const patch = (id: ButtonId, delta: Partial<{ x: number; y: number; size: number }>) => {
    setLayout((prev) => {
      const next = deepClone(prev);
      const cur = next.orientations[orientation].buttons[id];
      next.orientations[orientation].buttons[id] = { ...cur, ...delta };
      return next;
    });
  };

  const setOpacity = (v: number) => {
    setLayout((prev) => {
      const next = deepClone(prev);
      next.orientations[orientation].opacity = v;
      return next;
    });
  };

  const onReset = () => {
    setLayout((prev) => {
      const next = deepClone(prev);
      next.orientations[orientation] = orientation === "landscape"
        ? deepClone(DEFAULT_LANDSCAPE)
        : deepClone(DEFAULT_PORTRAIT);
      return next;
    });
    setSelected(null);
  };

  const onSave = () => {
    if (scope.kind === "global") {
      const g = loadGlobal();
      saveGlobal({ ...g, buttonLayout: layout });
    } else {
      const r = loadRom(scope.romId);
      saveRom(scope.romId, { ...r, buttonLayout: layout });
    }
    window.history.back();
  };

  const onCancel = () => {
    window.history.back();
  };

  return (
    <div className="editor-shell">
      <div className="editor-topbar">
        <div className="scope-label">{romName}</div>
        <span className="seg-wrap">
          <SegmentedControl<"portrait" | "landscape">
            options={[{ value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }]}
            value={orientation}
            onChange={setOrientation}
            testId="orient-toggle"
          />
        </span>
      </div>

      <EditorCanvas
        orientation={orientation}
        layout={current}
        selected={selected}
        onSelect={setSelected}
        onMove={(id, delta) => patch(id, delta)}
        onResize={(id, size) => patch(id, { size })}
        gridSnap={gridSnap}
      />

      <div className="editor-bottombar">
        <Slider
          label="Opacity"
          value={current.opacity}
          min={0.3} max={1.0} step={0.05}
          formatValue={(v) => `${Math.round(v * 100)}%`}
          onChange={setOpacity}
          testId="opacity"
        />
        <div className="row">
          <button
            onClick={() => setGridSnap(!gridSnap)}
            data-testid="grid-snap"
            style={{
              background: gridSnap ? "var(--accent)" : "var(--bg-3)",
              color: gridSnap ? "var(--accent-on)" : "var(--fg)",
              border: 0, borderRadius: "var(--r-md)",
              padding: "8px 12px", fontSize: 13, cursor: "pointer",
            }}
          >
            Grid snap {gridSnap ? "on" : "off"}
          </button>
          <button
            onClick={onReset}
            className="danger"
            data-testid="reset-orient"
            style={{
              background: "var(--bg-3)", color: "var(--danger)",
              border: 0, borderRadius: "var(--r-md)",
              padding: "8px 12px", fontSize: 13, cursor: "pointer",
            }}
          >
            Reset orientation
          </button>
        </div>
        <div className="actions">
          <button onClick={onCancel} data-testid="editor-cancel">Cancel</button>
          <button className="primary" onClick={onSave} data-testid="editor-save">Save</button>
        </div>
      </div>
    </div>
  );
}

function EditorCanvas({
  orientation, layout, selected, onSelect, onMove, onResize, gridSnap,
}: {
  orientation: "portrait" | "landscape";
  layout: OrientationLayout;
  selected: ButtonId | null;
  onSelect: (id: ButtonId | null) => void;
  onMove: (id: ButtonId, delta: { x?: number; y?: number }) => void;
  onResize: (id: ButtonId, size: number) => void;
  gridSnap: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [guides, setGuides] = useState<{ vert: number[]; horiz: number[] }>({ vert: [], horiz: [] });
  const safeArea = useSafeArea();

  const screenStyle = useMemo(() => {
    return orientation === "landscape"
      ? { width: "min(48vw, calc(60vh * 1.5))", aspectRatio: "240/160" }
      : { width: "min(72vw, calc(50vh * 1.5))", aspectRatio: "240/160" };
  }, [orientation]);

  const startDrag = (
    id: ButtonId,
    e: React.PointerEvent,
    mode: "move" | "resize",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(id);
    const wrap = wrapRef.current;
    if (!wrap) return;
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    const rect = wrap.getBoundingClientRect();
    const shortAxis = Math.min(rect.width, rect.height);
    const startX = e.clientX;
    const startY = e.clientY;
    const start = layout.buttons[id];

    const move = (ev: PointerEvent) => {
      const dxPct = ((ev.clientX - startX) / shortAxis) * 100;
      const dyPct = ((ev.clientY - startY) / shortAxis) * 100;
      if (mode === "move") {
        let x = start.x + dxPct;
        let y = start.y + dyPct;
        if (gridSnap) { x = Math.round(x / 4) * 4; y = Math.round(y / 4) * 4; }
        const clamped = clampToSafeArea({ x, y, size: start.size }, safeArea);
        // Compute alignment guides against other buttons.
        const allButtons = Object.entries(layout.buttons).filter(([k]) => k !== id);
        const vert: number[] = [];
        const horiz: number[] = [];
        for (const [, p] of allButtons) {
          if (Math.abs(p.x - clamped.x) < 1) vert.push(p.x);
          if (Math.abs(p.y - clamped.y) < 1) horiz.push(p.y);
        }
        setGuides({ vert, horiz });
        onMove(id, { x: clamped.x, y: clamped.y });
      } else {
        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        const next = start.size + (dist / shortAxis) * 0.04 * (ev.clientX > startX ? 1 : -1);
        onResize(id, Math.max(0.5, Math.min(2.0, next)));
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setGuides({ vert: [], horiz: [] });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <div
      className="editor-canvas"
      ref={wrapRef}
      style={{ opacity: layout.opacity }}
      onClick={() => onSelect(null)}
    >
      <div className="editor-screen" style={screenStyle as any} aria-label="GBA screen placeholder" />

      <div className="editor-guides" aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {guides.vert.map((x, i) => (
          <div key={`v${i}`} className="guide vert" style={{ left: `${x}%` }} />
        ))}
        {guides.horiz.map((y, i) => (
          <div key={`h${i}`} className="guide horiz" style={{ top: `${y}%` }} />
        ))}
      </div>

      {(Object.entries(layout.buttons) as [ButtonId, { x: number; y: number; size: number }][]).map(([id, p]) => {
        const baseSize = id === "dpad" ? 96 : id === "start" || id === "select" ? 56 : id === "l" || id === "r" ? 48 : 56;
        const w = baseSize * p.size;
        const h = id === "l" || id === "r" ? 28 * p.size : id === "start" || id === "select" ? 22 * p.size : w;
        return (
          <div
            key={id}
            className="btn-handle"
            data-selected={selected === id || undefined}
            data-testid={`handle-${id}`}
            style={{
              left: `${p.x}%`, top: `${p.y}%`,
              width: w, height: h,
              transform: "translate(-50%, -50%)",
            }}
            onPointerDown={(e) => startDrag(id, e, "move")}
          >
            <div className="move">{id.toUpperCase()}</div>
            <div
              className="resize"
              onPointerDown={(e) => startDrag(id, e, "resize")}
              role="slider"
              aria-label={`Resize ${id}`}
            >↘</div>
          </div>
        );
      })}
    </div>
  );
}

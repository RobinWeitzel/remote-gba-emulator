// Touch gamepad per SPEC §13. Uses native PointerEvent listeners (NOT React
// synthetic events) on the button DOM nodes, with setPointerCapture for
// reliable multi-touch (D-pad + face buttons simultaneously).
//
// Buttons are split into two panels — left (L, D-pad, Select) and right
// (R, B/A, Start). CSS on the parent .play-shell positions the panels;
// see styles.css `[data-layout="..."]` blocks. The component does not
// care which layout is active.

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { GbaButton } from "@gba/shared";
import type { OrientationLayout } from "../lib/settings";

interface Props {
  onPress: (b: GbaButton) => void;
  onRelease: (b: GbaButton) => void;
  // If true, the controls are visible but inert (follower mode).
  disabled?: boolean;
  buttonLayout?: OrientationLayout | null;
}

function attachButton(
  el: HTMLElement,
  button: GbaButton,
  onPress: (b: GbaButton) => void,
  onRelease: (b: GbaButton) => void,
): () => void {
  let activePointerId: number | null = null;

  const press = (e: PointerEvent) => {
    e.preventDefault();
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    el.classList.add("pad-pressed");
    onPress(button);
    if ((navigator as any).vibrate) (navigator as any).vibrate(8);
  };
  const release = (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    el.classList.remove("pad-pressed");
    onRelease(button);
  };
  el.addEventListener("pointerdown", press, { passive: false });
  el.addEventListener("pointerup", release, { passive: false });
  el.addEventListener("pointercancel", release, { passive: false });
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  return () => {
    el.removeEventListener("pointerdown", press as any);
    el.removeEventListener("pointerup", release as any);
    el.removeEventListener("pointercancel", release as any);
  };
}

function attachDpad(
  el: HTMLElement,
  onPress: (b: GbaButton) => void,
  onRelease: (b: GbaButton) => void,
): () => void {
  let activePointerId: number | null = null;
  const pressed = new Set<GbaButton>();

  const setDir = (clientX: number, clientY: number) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const deadzone = Math.min(r.width, r.height) * 0.18;
    const want = new Set<GbaButton>();
    if (Math.hypot(dx, dy) > deadzone) {
      const a = Math.atan2(dy, dx);
      const right = a > -3 * Math.PI / 8 && a < 3 * Math.PI / 8;
      const left = a > 5 * Math.PI / 8 || a < -5 * Math.PI / 8;
      const down = a > Math.PI / 8 && a < 7 * Math.PI / 8;
      const up = a < -Math.PI / 8 && a > -7 * Math.PI / 8;
      if (right) want.add("Right");
      if (left) want.add("Left");
      if (down) want.add("Down");
      if (up) want.add("Up");
    }
    for (const b of pressed) {
      if (!want.has(b)) {
        pressed.delete(b);
        onRelease(b);
      }
    }
    for (const b of want) {
      if (!pressed.has(b)) {
        pressed.add(b);
        onPress(b);
      }
    }
  };

  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    el.classList.add("pad-pressed");
    setDir(e.clientX, e.clientY);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;
    e.preventDefault();
    setDir(e.clientX, e.clientY);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    el.classList.remove("pad-pressed");
    for (const b of pressed) onRelease(b);
    pressed.clear();
  };
  el.addEventListener("pointerdown", onDown, { passive: false });
  el.addEventListener("pointermove", onMove, { passive: false });
  el.addEventListener("pointerup", onUp, { passive: false });
  el.addEventListener("pointercancel", onUp, { passive: false });
  el.addEventListener("contextmenu", (e) => e.preventDefault());

  return () => {
    el.removeEventListener("pointerdown", onDown as any);
    el.removeEventListener("pointermove", onMove as any);
    el.removeEventListener("pointerup", onUp as any);
    el.removeEventListener("pointercancel", onUp as any);
  };
}

// Desktop keyboard map. Mirrors the touch layout — arrow keys / WASD on
// the d-pad, Z/X on B/A (the natural play position), A/S on shoulders,
// Enter on Start, Right-Shift / Backspace on Select. Keys are matched on
// e.code so layout (QWERTY/AZERTY/Dvorak) doesn't matter.
const KEY_MAP: Record<string, GbaButton> = {
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  KeyW: "Up", KeyS: "Down", KeyA: "Left", KeyD: "Right",
  KeyZ: "B", KeyX: "A",
  KeyQ: "L", KeyE: "R",
  Enter: "Start", Backspace: "Select", ShiftRight: "Select",
};

export function Gamepad({ onPress, onRelease, disabled, buttonLayout }: Props) {
  const dpadRef = useRef<HTMLDivElement | null>(null);
  const aRef = useRef<HTMLButtonElement | null>(null);
  const bRef = useRef<HTMLButtonElement | null>(null);
  const lRef = useRef<HTMLButtonElement | null>(null);
  const rRef = useRef<HTMLButtonElement | null>(null);
  const startRef = useRef<HTMLButtonElement | null>(null);
  const selectRef = useRef<HTMLButtonElement | null>(null);

  // Stash the latest handlers in refs so the pointer & keyboard effects
  // can install listeners ONCE per (mount, disabled-flip) — without those
  // refs, every parent re-render churns through detach/attach (and the
  // keyboard effect would release every held key on every render).
  const pressRef = useRef(onPress);
  const releaseRef = useRef(onRelease);
  useEffect(() => { pressRef.current = onPress; }, [onPress]);
  useEffect(() => { releaseRef.current = onRelease; }, [onRelease]);
  const pressVia = (b: GbaButton) => pressRef.current(b);
  const releaseVia = (b: GbaButton) => releaseRef.current(b);

  useEffect(() => {
    if (disabled) return;
    const offs: (() => void)[] = [];
    if (dpadRef.current) offs.push(attachDpad(dpadRef.current, pressVia, releaseVia));
    if (aRef.current) offs.push(attachButton(aRef.current, "A", pressVia, releaseVia));
    if (bRef.current) offs.push(attachButton(bRef.current, "B", pressVia, releaseVia));
    if (lRef.current) offs.push(attachButton(lRef.current, "L", pressVia, releaseVia));
    if (rRef.current) offs.push(attachButton(rRef.current, "R", pressVia, releaseVia));
    if (startRef.current) offs.push(attachButton(startRef.current, "Start", pressVia, releaseVia));
    if (selectRef.current) offs.push(attachButton(selectRef.current, "Select", pressVia, releaseVia));
    return () => { for (const o of offs) o(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  // Keyboard. Only fires when no editable element has focus, so typing
  // a name in an input doesn't smash the d-pad. Tracks which buttons we
  // pressed so a blur/visibility flip releases them cleanly.
  useEffect(() => {
    if (disabled) return;
    const held = new Set<GbaButton>();
    const isEditable = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable()) return;
      const b = KEY_MAP[e.code];
      if (!b) return;
      e.preventDefault();
      if (held.has(b)) return;
      held.add(b);
      pressRef.current(b);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const b = KEY_MAP[e.code];
      if (!b) return;
      e.preventDefault();
      if (!held.has(b)) return;
      held.delete(b);
      releaseRef.current(b);
    };
    const releaseAll = () => {
      for (const b of held) releaseRef.current(b);
      held.clear();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", releaseAll);
    return () => {
      releaseAll();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseAll);
      document.removeEventListener("visibilitychange", releaseAll);
    };
  }, [disabled]);

  const disabledCls = disabled ? " pad-disabled" : "";

  const cssVars: CSSProperties = buttonLayout
    ? Object.assign(
        { ["--pad-opacity"]: buttonLayout.opacity } as Record<string, unknown>,
        ...Object.entries(buttonLayout.buttons).map(([id, p]) => ({
          [`--btn-${id}-x`]: `${p.x}%`,
          [`--btn-${id}-y`]: `${p.y}%`,
          [`--btn-${id}-size`]: p.size,
        })),
      ) as CSSProperties
    : {};

  return (
    <div className="pad-host" style={cssVars} data-custom={buttonLayout ? "true" : undefined}>
      {!buttonLayout && (
        <>
          <div className={`pad-panel pad-panel-left${disabledCls}`} aria-hidden={disabled}>
            <button ref={lRef} className="pad-btn pad-shoulder">L</button>
            <div ref={dpadRef} className="pad-dpad" aria-label="D-pad">
              <div className="dpad-up">▲</div>
              <div className="dpad-left">◀</div>
              <div className="dpad-right">▶</div>
              <div className="dpad-down">▼</div>
              <div className="dpad-center" />
            </div>
            <button ref={selectRef} className="pad-btn pad-pill">SELECT</button>
          </div>
          <div className={`pad-panel pad-panel-right${disabledCls}`} aria-hidden={disabled}>
            <button ref={rRef} className="pad-btn pad-shoulder">R</button>
            <div className="pad-face">
              <button ref={bRef} className="pad-btn pad-face-b">B</button>
              <button ref={aRef} className="pad-btn pad-face-a">A</button>
            </div>
            <button ref={startRef} className="pad-btn pad-pill">START</button>
          </div>
        </>
      )}
      {buttonLayout && (
        <>
          <button ref={lRef} className="pad-btn pad-shoulder pad-l-custom pad-btn-custom">L</button>
          <button ref={rRef} className="pad-btn pad-shoulder pad-r-custom pad-btn-custom">R</button>
          <div ref={dpadRef} className="pad-dpad pad-dpad-custom" aria-label="D-pad">
            <div className="dpad-up">▲</div>
            <div className="dpad-left">◀</div>
            <div className="dpad-right">▶</div>
            <div className="dpad-down">▼</div>
            <div className="dpad-center" />
          </div>
          <button ref={bRef} className="pad-btn pad-face-b pad-b-custom pad-btn-custom">B</button>
          <button ref={aRef} className="pad-btn pad-face-a pad-a-custom pad-btn-custom">A</button>
          <button ref={startRef} className="pad-btn pad-pill pad-start-custom pad-btn-custom">START</button>
          <button ref={selectRef} className="pad-btn pad-pill pad-select-custom pad-btn-custom">SELECT</button>
        </>
      )}
    </div>
  );
}

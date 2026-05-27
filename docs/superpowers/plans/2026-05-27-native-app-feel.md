# Native-app feel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape Play-Together GBA into a touch-first mobile/tablet app with a swipeable carousel home, a peek-sheet in-game UI, a `/settings` page with per-game customizations, and a live button-layout editor.

**Architecture:** Six independently shippable milestones. M1 lays a design-token CSS layer + small primitives library (`Sheet`, `ActionSheet`, `Modal`, `Prompt`, `Carousel`, `FAB`, `Slider`, `SegmentedControl`, `StatusPill`) and a testing baseline (Vitest + React Testing Library). M2 introduces a `localStorage`-backed settings layer (global + per-ROM) and the `/settings` page. M3 rewrites `HomePage`, M4 rewrites the in-game session UI, M5 ships the `/edit-controls` button editor. M6 polishes haptics, transitions, and runs cross-device smoke tests.

**Tech Stack:** React 18 + Vite + TypeScript (existing). New dev deps: `vitest`, `@vitest/ui`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-05-27-native-app-feel-design.md`

---

## Reading order & ground rules

- Files are referenced by **exact path**. The existing codebase uses `client/src/...` for the SPA.
- Every milestone ends with a smoke-test step on the dev server (`npm run dev` → http://localhost:5173/). Take a screenshot via Playwright MCP and visually confirm the milestone's user-visible change.
- Commits are bite-sized — one feature/component per commit. The project's commit-message convention (see `git log`) is short, lowercase, with a `feat:` / `fix:` / `refactor:` / `chore:` / `ui:` / `docs:` prefix.
- The project uses a tiny custom router (`client/src/lib/router.ts` — `useRoute()` + `navigate()`). No react-router. All new routes register in `client/src/App.tsx`.
- The project has no test runner today. M1 adds Vitest; all tests written from M1 onward go in a `*.test.ts(x)` file colocated with the unit under test.
- `data-testid` attributes are already idiomatic in the codebase — keep using them on interactive elements so E2E checks via Playwright MCP can target them.
- **DO NOT** modify the WS protocol, the mGBA wrapper, the save store, or the contributor ledger. The spec keeps the server contract untouched.

---

## Milestone M1 — Design tokens, primitives, test setup

**Goal at end of M1:** Vitest runs; tokens.css loads at the top of the styles cascade; a temporary `/primitives` showcase route renders every primitive in a scrolling list so we can manually confirm look & behavior before wiring them up.

### Task 1.1: Add Vitest + RTL dev dependencies

**Files:**
- Modify: `client/package.json`
- Create: `client/vitest.config.ts`
- Create: `client/src/test/setup.ts`

- [ ] **Step 1: Install dev dependencies**

Run from repo root:
```bash
npm --workspace client install -D vitest@^2.1.0 @vitest/ui@^2.1.0 jsdom@^25.0.0 @testing-library/react@^16.0.0 @testing-library/user-event@^14.5.0 @testing-library/jest-dom@^6.6.0
```

- [ ] **Step 2: Add `test` and `test:ui` scripts**

Edit `client/package.json`. Inside `"scripts"`, add `test` and `test:ui` after `typecheck`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run",
    "test:ui": "vitest --ui"
  }
}
```

- [ ] **Step 3: Create `client/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@gba/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: true,
  },
});
```

- [ ] **Step 4: Create `client/src/test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 5: Add types reference to tsconfig**

Edit `client/tsconfig.json`. Inside `"compilerOptions"`, add `"types": ["vitest/globals"]`. If the field already exists, append `"vitest/globals"` to the array.

- [ ] **Step 6: Verify Vitest boots**

```bash
npm --workspace client run test
```

Expected output: `No test files found, exiting with code 1` (or similar) — confirms the runner starts and finds the config.

- [ ] **Step 7: Commit**

```bash
git add client/package.json client/vitest.config.ts client/src/test/setup.ts client/tsconfig.json package-lock.json
git commit -m "chore: vitest + RTL test harness for client"
```

### Task 1.2: Create `tokens.css` and load it first

**Files:**
- Create: `client/src/ui/tokens.css`
- Modify: `client/src/main.tsx`

- [ ] **Step 1: Create `client/src/ui/tokens.css`**

```css
/* Design tokens. Imported first so every other stylesheet can use these vars. */

:root {
  /* Radii */
  --r-sm: 10px;
  --r-md: 14px;
  --r-lg: 18px;
  --r-xl: 24px;

  /* Surfaces — dark default */
  --bg-0: #0b0b0e;       /* page */
  --bg-1: #15151b;       /* card */
  --bg-2: #1c1c24;       /* sheet */
  --bg-3: #23232d;       /* elevated within sheet */
  --fg:   #e8e8ee;
  --fg-muted: #a0a0b0;
  --fg-dim:   #6c6c80;
  --accent:   #7c5cff;
  --accent-on: #ffffff;
  --danger:   #ff5c7c;

  /* Motion */
  --ease-app: cubic-bezier(.32,.72,0,1);
  --dur-fast: 140ms;
  --dur-base: 220ms;
  --dur-sheet: 320ms;

  /* Touch */
  --tap-min: 44px;

  /* Depth */
  --sh-1: 0 1px 2px rgba(0,0,0,.25);
  --sh-2: 0 4px 12px rgba(0,0,0,.35);
  --sh-3: 0 8px 24px rgba(0,0,0,.45);
  --sh-4: 0 16px 48px rgba(0,0,0,.55);

  /* Safe-area shorthands (use directly or with calc()) */
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
}
```

- [ ] **Step 2: Import tokens.css BEFORE styles.css in `main.tsx`**

Open `client/src/main.tsx` and ensure the import order is:

```tsx
import "./ui/tokens.css";
import "./ui/styles.css";
```

`tokens.css` MUST be imported before `styles.css` so the cascade reads token values first.

- [ ] **Step 3: Verify in browser**

```bash
npm run dev
```

Open http://localhost:5173/, open DevTools → Elements → `:root` → confirm `--r-sm`, `--accent`, etc. appear in computed styles. Take a Playwright MCP screenshot of the home page — visually unchanged, but new tokens are loaded.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/tokens.css client/src/main.tsx
git commit -m "feat(ui): design tokens loaded ahead of styles cascade"
```

### Task 1.3: Add the `useLongPress` hook (no dependencies — test it first)

**Files:**
- Create: `client/src/ui/hooks/useLongPress.ts`
- Create: `client/src/ui/hooks/useLongPress.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/ui/hooks/useLongPress.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLongPress } from "./useLongPress";

describe("useLongPress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires the handler after the hold duration", () => {
    const handler = vi.fn();
    const { result } = renderHook(() => useLongPress(handler, 500));
    act(() => { result.current.onPointerDown({ pointerId: 1 } as any); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire if released before the duration", () => {
    const handler = vi.fn();
    const { result } = renderHook(() => useLongPress(handler, 500));
    act(() => { result.current.onPointerDown({ pointerId: 1 } as any); });
    act(() => { vi.advanceTimersByTime(200); });
    act(() => { result.current.onPointerUp({ pointerId: 1 } as any); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(handler).not.toHaveBeenCalled();
  });

  it("cancels on pointercancel", () => {
    const handler = vi.fn();
    const { result } = renderHook(() => useLongPress(handler, 500));
    act(() => { result.current.onPointerDown({ pointerId: 1 } as any); });
    act(() => { result.current.onPointerCancel({ pointerId: 1 } as any); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

```bash
npm --workspace client run test -- useLongPress
```

Expected: FAIL — `Cannot find module './useLongPress'`.

- [ ] **Step 3: Implement the hook**

Create `client/src/ui/hooks/useLongPress.ts`:

```ts
import { useRef } from "react";

export interface LongPressHandlers {
  onPointerDown: (e: { pointerId: number }) => void;
  onPointerUp: (e: { pointerId: number }) => void;
  onPointerCancel: (e: { pointerId: number }) => void;
  onPointerLeave: (e: { pointerId: number }) => void;
}

export function useLongPress(
  handler: () => void,
  ms = 500,
): LongPressHandlers {
  const timerRef = useRef<number | null>(null);
  const activePointerRef = useRef<number | null>(null);

  const cancel = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    activePointerRef.current = null;
  };

  return {
    onPointerDown: (e) => {
      if (activePointerRef.current !== null) return;
      activePointerRef.current = e.pointerId;
      timerRef.current = window.setTimeout(() => {
        handler();
        cancel();
      }, ms);
    },
    onPointerUp: (e) => {
      if (e.pointerId !== activePointerRef.current) return;
      cancel();
    },
    onPointerCancel: (e) => {
      if (e.pointerId !== activePointerRef.current) return;
      cancel();
    },
    onPointerLeave: (e) => {
      if (e.pointerId !== activePointerRef.current) return;
      cancel();
    },
  };
}
```

- [ ] **Step 4: Run test, confirm it passes**

```bash
npm --workspace client run test -- useLongPress
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/ui/hooks/useLongPress.ts client/src/ui/hooks/useLongPress.test.ts
git commit -m "feat(ui): useLongPress hook with cancel semantics"
```

### Task 1.4: Add the `useSafeArea` hook

**Files:**
- Create: `client/src/ui/hooks/useSafeArea.ts`

- [ ] **Step 1: Write the hook**

Create `client/src/ui/hooks/useSafeArea.ts`:

```ts
import { useEffect, useState } from "react";

export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const readInset = (side: "top" | "bottom" | "left" | "right"): number => {
  if (typeof window === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;left:0;top:0;padding-${side}:env(safe-area-inset-${side},0px);visibility:hidden;`;
  document.body.appendChild(probe);
  const v = parseFloat(getComputedStyle(probe).paddingTop || "0");
  // Re-read from the correct side after appending.
  const computed = parseFloat(
    getComputedStyle(probe).getPropertyValue(`padding-${side}`) || "0",
  );
  document.body.removeChild(probe);
  return Number.isFinite(computed) ? computed : v;
};

export function useSafeArea(): SafeAreaInsets {
  const [insets, setInsets] = useState<SafeAreaInsets>(() => ({
    top: 0, bottom: 0, left: 0, right: 0,
  }));
  useEffect(() => {
    const read = () => {
      setInsets({
        top: readInset("top"),
        bottom: readInset("bottom"),
        left: readInset("left"),
        right: readInset("right"),
      });
    };
    read();
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    return () => {
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
    };
  }, []);
  return insets;
}
```

- [ ] **Step 2: Quick smoke test (manual)**

Run `npm run dev`, open the home page on a phone or in DevTools' device emulator with "iPhone 14 Pro" (has notch). Open the console and run:
```js
// In a temporary test mount, log useSafeArea() output — should show top > 0 on notched profiles.
```

This hook will be exercised by the Sheet/Modal in later tasks; deferring an automated test until then is intentional.

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/hooks/useSafeArea.ts
git commit -m "feat(ui): useSafeArea hook reading env(safe-area-inset-*)"
```

### Task 1.5: Add the `useHaptics` hook + `lib/haptics.ts`

**Files:**
- Create: `client/src/lib/haptics.ts`
- Create: `client/src/ui/hooks/useHaptics.ts`
- Create: `client/src/lib/haptics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/haptics.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { vibrate, type HapticsMode } from "./haptics";

describe("vibrate", () => {
  beforeEach(() => {
    (navigator as any).vibrate = vi.fn();
  });

  it("does not call vibrate when mode is 'off'", () => {
    vibrate("off", "tap");
    expect((navigator as any).vibrate).not.toHaveBeenCalled();
  });

  it("calls vibrate(8) for 'light' mode on a tap", () => {
    vibrate("light", "tap");
    expect((navigator as any).vibrate).toHaveBeenCalledWith(8);
  });

  it("calls vibrate(15) for 'strong' mode on a tap", () => {
    vibrate("strong", "tap");
    expect((navigator as any).vibrate).toHaveBeenCalledWith(15);
  });

  it("calls vibrate(20) for 'strong' mode on a 'success' event", () => {
    vibrate("strong", "success");
    expect((navigator as any).vibrate).toHaveBeenCalledWith(20);
  });

  it("no-ops gracefully when navigator.vibrate is undefined", () => {
    (navigator as any).vibrate = undefined;
    expect(() => vibrate("light", "tap")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

```bash
npm --workspace client run test -- haptics
```

Expected: FAIL — `Cannot find module './haptics'`.

- [ ] **Step 3: Implement haptics.ts**

Create `client/src/lib/haptics.ts`:

```ts
export type HapticsMode = "off" | "light" | "strong";
export type HapticsEvent = "tap" | "snap" | "success" | "warn";

const PATTERNS: Record<HapticsMode, Record<HapticsEvent, number | number[]>> = {
  off: { tap: 0, snap: 0, success: 0, warn: 0 },
  light: { tap: 8, snap: 6, success: 12, warn: [10, 40, 10] },
  strong: { tap: 15, snap: 12, success: 20, warn: [20, 60, 20] },
};

export function vibrate(mode: HapticsMode, event: HapticsEvent): void {
  if (mode === "off") return;
  const v = (navigator as any).vibrate;
  if (typeof v !== "function") return;
  const pattern = PATTERNS[mode][event];
  if (!pattern) return;
  try { v.call(navigator, pattern); } catch { /* ignore */ }
}
```

- [ ] **Step 4: Run test, confirm it passes**

```bash
npm --workspace client run test -- haptics
```

Expected: PASS (5 tests).

- [ ] **Step 5: Implement `useHaptics` hook**

Create `client/src/ui/hooks/useHaptics.ts`:

```ts
import { useCallback } from "react";
import { vibrate, type HapticsEvent, type HapticsMode } from "../../lib/haptics";

// Reads the current haptics mode from localStorage on every call. Cheap;
// no need to subscribe — settings rarely change at runtime, and a stale
// read just affects the very next event.
function readMode(): HapticsMode {
  try {
    const raw = localStorage.getItem("settings.global");
    if (!raw) return "light";
    const parsed = JSON.parse(raw);
    const m = parsed?.haptics;
    if (m === "off" || m === "light" || m === "strong") return m;
  } catch { /* ignore */ }
  return "light";
}

export function useHaptics(): (event: HapticsEvent) => void {
  return useCallback((event: HapticsEvent) => {
    vibrate(readMode(), event);
  }, []);
}
```

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/haptics.ts client/src/lib/haptics.test.ts client/src/ui/hooks/useHaptics.ts
git commit -m "feat(ui): haptics helper + useHaptics hook with mode/event matrix"
```

### Task 1.6: Build `Sheet` primitive (with internal drag state)

The `Sheet` is the single most important primitive — `ActionSheet`, the in-game peek sheet, the new-save sheet, the per-game settings sheet, and the player-edit sheet all use it.

**Files:**
- Create: `client/src/ui/primitives/Sheet.tsx`
- Create: `client/src/ui/primitives/primitives.css`
- Modify: `client/src/main.tsx` (add primitives.css import)

- [ ] **Step 1: Create `client/src/ui/primitives/primitives.css`**

```css
/* Shared styles for primitives. Loaded by main.tsx after tokens.css. */

.app-sheet-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.5);
  z-index: 80;
  opacity: 0;
  transition: opacity var(--dur-base) var(--ease-app);
  pointer-events: none;
}
.app-sheet-backdrop[data-state="expanded"] { opacity: 1; pointer-events: auto; }
.app-sheet-backdrop[data-state="peek"] { opacity: 0; pointer-events: none; }
.app-sheet-backdrop[data-state="closed"] { opacity: 0; pointer-events: none; }

.app-sheet {
  position: fixed; left: 0; right: 0; bottom: 0;
  background: var(--bg-2);
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  box-shadow: var(--sh-3);
  z-index: 90;
  color: var(--fg);
  padding-bottom: var(--safe-bottom);
  touch-action: none;
  transform: translate3d(0, 0, 0);
  transition: transform var(--dur-sheet) var(--ease-app);
}
.app-sheet[data-dragging="true"] { transition: none; }

.app-sheet-handle {
  display: flex; justify-content: center; padding: 8px 0 4px;
}
.app-sheet-handle::before {
  content: ""; width: 36px; height: 4px;
  background: var(--fg-dim);
  border-radius: 99px;
}

.app-sheet-content { padding: 4px 16px 20px; }
</style>
```

(Remove the trailing `</style>` — that was a typo. The file is plain CSS.)

Actual file contents:

```css
.app-sheet-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.5);
  z-index: 80;
  opacity: 0;
  transition: opacity var(--dur-base) var(--ease-app);
  pointer-events: none;
}
.app-sheet-backdrop[data-state="expanded"] { opacity: 1; pointer-events: auto; }
.app-sheet-backdrop[data-state="peek"] { opacity: 0; pointer-events: none; }
.app-sheet-backdrop[data-state="closed"] { opacity: 0; pointer-events: none; }

.app-sheet {
  position: fixed; left: 0; right: 0; bottom: 0;
  background: var(--bg-2);
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  box-shadow: var(--sh-3);
  z-index: 90;
  color: var(--fg);
  padding-bottom: var(--safe-bottom);
  touch-action: none;
  transform: translate3d(0, 0, 0);
  transition: transform var(--dur-sheet) var(--ease-app);
}
.app-sheet[data-dragging="true"] { transition: none; }

.app-sheet-handle {
  display: flex; justify-content: center; padding: 8px 0 4px;
}
.app-sheet-handle::before {
  content: ""; width: 36px; height: 4px;
  background: var(--fg-dim);
  border-radius: 99px;
}

.app-sheet-content { padding: 4px 16px 20px; }
```

- [ ] **Step 2: Import `primitives.css` in `main.tsx`**

The import order in `client/src/main.tsx` becomes:

```tsx
import "./ui/tokens.css";
import "./ui/primitives/primitives.css";
import "./ui/styles.css";
```

- [ ] **Step 3: Create `client/src/ui/primitives/Sheet.tsx`**

```tsx
// Bottom sheet with three states: closed, peek (always visible), expanded.
// Drag the handle to switch between peek <-> expanded. Backdrop appears
// only in expanded state. The drag uses PointerEvents (same pattern as
// the existing Gamepad component) for reliable multi-touch behaviour.

import { useEffect, useRef, useState, type ReactNode } from "react";

export type SheetState = "closed" | "peek" | "expanded";

interface Props {
  state: SheetState;
  onStateChange: (next: SheetState) => void;
  peekHeight?: number;     // px; if 0, no peek shown when state="peek"
  expandedHeight?: string; // CSS value; defaults to 75dvh
  children: ReactNode;     // sheet content (everything below the handle)
  handle?: ReactNode;      // optional custom handle area; default = the grabber
}

export function Sheet({
  state,
  onStateChange,
  peekHeight = 52,
  expandedHeight = "75dvh",
  children,
  handle,
}: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragStartY = useRef<number>(0);
  const dragStartTranslateY = useRef<number>(0);

  // Resolve the resting Y offset (from bottom) given the current state.
  // We render the sheet at expanded height always; CSS transform shifts
  // it down for peek/closed.
  const restingOffset = (s: SheetState): number => {
    if (!elRef.current) return 0;
    const h = elRef.current.getBoundingClientRect().height;
    if (s === "expanded") return 0;
    if (s === "peek") return h - peekHeight;
    return h; // closed: hidden offscreen
  };

  useEffect(() => {
    if (!elRef.current) return;
    elRef.current.style.transform = `translate3d(0, ${restingOffset(state)}px, 0)`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, peekHeight]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (state === "closed") return;
    const el = elRef.current;
    if (!el) return;
    setDragging(true);
    dragStartY.current = e.clientY;
    const current = new DOMMatrix(getComputedStyle(el).transform).m42;
    dragStartTranslateY.current = current;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const el = elRef.current;
    if (!el) return;
    const dy = e.clientY - dragStartY.current;
    const h = el.getBoundingClientRect().height;
    const next = Math.max(0, Math.min(h, dragStartTranslateY.current + dy));
    el.style.transform = `translate3d(0, ${next}px, 0)`;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    const el = elRef.current;
    if (!el) return;
    try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    const current = new DOMMatrix(getComputedStyle(el).transform).m42;
    const h = el.getBoundingClientRect().height;
    const peekOffset = h - peekHeight;
    // Snap to the closer of expanded (0) or peek (peekOffset).
    const next: SheetState = current < peekOffset / 2 ? "expanded" : "peek";
    onStateChange(next);
  };

  return (
    <>
      <div
        className="app-sheet-backdrop"
        data-state={state}
        onClick={() => onStateChange(state === "expanded" ? "peek" : state)}
      />
      <div
        ref={elRef}
        className="app-sheet"
        data-state={state}
        data-dragging={dragging || undefined}
        style={{ height: expandedHeight }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="dialog"
        aria-modal={state === "expanded"}
      >
        {handle ?? <div className="app-sheet-handle" aria-hidden />}
        <div className="app-sheet-content">{children}</div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Write a snapshot/render test for Sheet**

Create `client/src/ui/primitives/Sheet.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sheet } from "./Sheet";

describe("Sheet", () => {
  it("renders content and exposes role=dialog", () => {
    render(
      <Sheet state="expanded" onStateChange={() => {}}>
        <p>hello sheet</p>
      </Sheet>,
    );
    expect(screen.getByText("hello sheet")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("invokes onStateChange when the backdrop is clicked from expanded", () => {
    const onStateChange = vi.fn();
    const { container } = render(
      <Sheet state="expanded" onStateChange={onStateChange}>
        <p>x</p>
      </Sheet>,
    );
    const backdrop = container.querySelector(".app-sheet-backdrop")!;
    fireEvent.click(backdrop);
    expect(onStateChange).toHaveBeenCalledWith("peek");
  });
});
```

- [ ] **Step 5: Run tests**

```bash
npm --workspace client run test -- Sheet
```

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add client/src/ui/primitives/Sheet.tsx client/src/ui/primitives/primitives.css client/src/ui/primitives/Sheet.test.tsx client/src/main.tsx
git commit -m "feat(ui): Sheet primitive with peek/expanded states + drag-to-snap"
```

### Task 1.7: Build `ActionSheet` primitive

**Files:**
- Create: `client/src/ui/primitives/ActionSheet.tsx`
- Modify: `client/src/ui/primitives/primitives.css` (append action-sheet styles)

- [ ] **Step 1: Append styles to `primitives.css`**

Append:

```css
.app-action-sheet { padding: 0 0 8px; }
.app-action-sheet h3 { margin: 4px 16px 12px; font-size: 14px; color: var(--fg-muted); font-weight: 600; }
.app-action-sheet button {
  display: flex; align-items: center; gap: 12px;
  width: 100%; min-height: var(--tap-min);
  background: transparent; color: var(--fg);
  border: 0; padding: 14px 18px;
  font-size: 16px; text-align: left;
  cursor: pointer;
}
.app-action-sheet button:active { background: var(--bg-3); }
.app-action-sheet button[data-destructive="true"] { color: var(--danger); }
.app-action-sheet hr {
  border: 0; height: 1px; background: var(--bg-3); margin: 6px 0;
}
.app-action-sheet .chevron { margin-left: auto; color: var(--fg-dim); }
```

- [ ] **Step 2: Create `client/src/ui/primitives/ActionSheet.tsx`**

```tsx
// Opinionated sheet for "list of actions with optional destructive last."
// Replaces window.confirm.

import { Sheet, type SheetState } from "./Sheet";

export interface ActionItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  trailing?: "chevron" | null;
  testId?: string;
}

interface Props {
  open: boolean;
  title?: string;
  items: ActionItem[];
  onClose: () => void;
}

export function ActionSheet({ open, title, items, onClose }: Props) {
  const state: SheetState = open ? "expanded" : "closed";
  return (
    <Sheet
      state={state}
      onStateChange={(next) => { if (next !== "expanded") onClose(); }}
      expandedHeight="auto"
    >
      <div className="app-action-sheet">
        {title && <h3>{title}</h3>}
        {items.map((it, i) => {
          const isLast = i === items.length - 1;
          const showSepBefore = it.destructive && !isLast === false && items.some((x) => !x.destructive);
          return (
            <div key={i}>
              {showSepBefore && <hr />}
              <button
                data-destructive={it.destructive || undefined}
                data-testid={it.testId}
                onClick={() => { it.onSelect(); onClose(); }}
              >
                <span>{it.label}</span>
                {it.trailing === "chevron" && <span className="chevron">›</span>}
              </button>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
```

- [ ] **Step 3: Smoke test in a tiny showcase (deferred to Task 1.16)**

We'll wire ActionSheet into the `/primitives` showcase route at the end of M1.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/primitives/ActionSheet.tsx client/src/ui/primitives/primitives.css
git commit -m "feat(ui): ActionSheet primitive — opinionated list-of-actions"
```

### Task 1.8: Build `Modal` primitive

**Files:**
- Create: `client/src/ui/primitives/Modal.tsx`
- Modify: `client/src/ui/primitives/primitives.css` (append modal styles)

- [ ] **Step 1: Append styles**

```css
.app-modal-backdrop {
  position: fixed; inset: 0;
  background: var(--bg-0);
  z-index: 100;
  display: flex; align-items: stretch; justify-content: stretch;
}
.app-modal {
  flex: 1;
  background: var(--bg-0);
  color: var(--fg);
  padding: calc(var(--safe-top) + 16px) calc(var(--safe-right) + 16px)
          calc(var(--safe-bottom) + 16px) calc(var(--safe-left) + 16px);
  overflow: auto;
  animation: app-modal-in var(--dur-base) var(--ease-app);
}
@keyframes app-modal-in {
  from { opacity: 0; transform: scale(.98); }
  to   { opacity: 1; transform: scale(1); }
}
```

- [ ] **Step 2: Create `client/src/ui/primitives/Modal.tsx`**

```tsx
import { useEffect, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  labelledBy?: string;
}

export function Modal({ open, onClose, children, labelledBy }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="app-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <div className="app-modal">{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/primitives/Modal.tsx client/src/ui/primitives/primitives.css
git commit -m "feat(ui): Modal primitive (full-screen, esc-to-close)"
```

### Task 1.9: Build `Prompt` primitive (text-entry sheet replacing window.prompt)

**Files:**
- Create: `client/src/ui/primitives/Prompt.tsx`
- Modify: `client/src/ui/primitives/primitives.css` (append prompt styles)

- [ ] **Step 1: Append styles**

```css
.app-prompt { display: flex; flex-direction: column; gap: 12px; }
.app-prompt h3 { margin: 0; font-size: 17px; }
.app-prompt p { margin: 0; color: var(--fg-muted); font-size: 13px; }
.app-prompt input {
  background: var(--bg-3); color: var(--fg);
  border: 1px solid transparent; border-radius: var(--r-md);
  padding: 12px 14px; font-size: 16px;
}
.app-prompt input:focus { border-color: var(--accent); outline: 0; }
.app-prompt .actions {
  display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px;
}
.app-prompt button {
  min-height: var(--tap-min);
  padding: 10px 18px;
  border-radius: var(--r-md);
  border: 0;
  font-size: 15px; font-weight: 600;
  background: var(--bg-3); color: var(--fg);
  cursor: pointer;
}
.app-prompt button.primary { background: var(--accent); color: var(--accent-on); }
.app-prompt button:disabled { opacity: .5; cursor: not-allowed; }
```

- [ ] **Step 2: Create `client/src/ui/primitives/Prompt.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { Sheet, type SheetState } from "./Sheet";

interface Props {
  open: boolean;
  title: string;
  description?: string;
  initialValue?: string;
  placeholder?: string;
  cta?: string;          // primary button label
  maxLength?: number;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function Prompt({
  open, title, description, initialValue = "",
  placeholder, cta = "Save", maxLength = 64,
  onSubmit, onCancel,
}: Props) {
  const [v, setV] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setV(initialValue);
      // Defer focus to next tick so the sheet has animated in.
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, initialValue]);

  const ok = v.trim().length > 0;
  const state: SheetState = open ? "expanded" : "closed";

  return (
    <Sheet
      state={state}
      onStateChange={(next) => { if (next !== "expanded") onCancel(); }}
      expandedHeight="auto"
    >
      <div className="app-prompt">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
        <input
          ref={inputRef}
          value={v}
          onChange={(e) => setV(e.target.value.slice(0, maxLength))}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ok) onSubmit(v.trim());
            if (e.key === "Escape") onCancel();
          }}
          data-testid="prompt-input"
        />
        <div className="actions">
          <button onClick={onCancel} data-testid="prompt-cancel">Cancel</button>
          <button
            className="primary"
            disabled={!ok}
            onClick={() => onSubmit(v.trim())}
            data-testid="prompt-submit"
          >
            {cta}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/primitives/Prompt.tsx client/src/ui/primitives/primitives.css
git commit -m "feat(ui): Prompt primitive (sheet replacing window.prompt)"
```

### Task 1.10: Build `FAB` primitive

**Files:**
- Create: `client/src/ui/primitives/FAB.tsx`
- Modify: `client/src/ui/primitives/primitives.css` (append FAB styles)

- [ ] **Step 1: Append styles**

```css
.app-fab {
  position: fixed;
  right: calc(var(--safe-right) + 16px);
  bottom: calc(var(--safe-bottom) + 24px);
  width: 56px; height: 56px;
  border-radius: 50%; border: 0;
  background: var(--accent); color: var(--accent-on);
  box-shadow: var(--sh-3);
  font-size: 28px; font-weight: 300;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; z-index: 70;
  transition: transform var(--dur-fast) var(--ease-app);
}
.app-fab:active { transform: scale(.95); }
```

- [ ] **Step 2: Create `client/src/ui/primitives/FAB.tsx`**

```tsx
import type { ReactNode } from "react";
import { useHaptics } from "../hooks/useHaptics";

interface Props {
  onClick: () => void;
  children: ReactNode;
  ariaLabel: string;
  testId?: string;
}

export function FAB({ onClick, children, ariaLabel, testId }: Props) {
  const haptics = useHaptics();
  return (
    <button
      className="app-fab"
      aria-label={ariaLabel}
      data-testid={testId}
      onClick={() => { haptics("tap"); onClick(); }}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/primitives/FAB.tsx client/src/ui/primitives/primitives.css
git commit -m "feat(ui): FAB primitive"
```

### Task 1.11: Build `Slider` primitive

**Files:**
- Create: `client/src/ui/primitives/Slider.tsx`
- Modify: `client/src/ui/primitives/primitives.css` (append slider styles)

- [ ] **Step 1: Append styles**

```css
.app-slider { display: flex; flex-direction: column; gap: 6px; }
.app-slider-label {
  display: flex; justify-content: space-between; align-items: baseline;
  color: var(--fg-muted); font-size: 13px;
}
.app-slider-label .value { color: var(--fg); font-weight: 600; font-variant-numeric: tabular-nums; }
.app-slider input[type=range] {
  -webkit-appearance: none; appearance: none;
  width: 100%; height: 32px; background: transparent;
}
.app-slider input[type=range]::-webkit-slider-runnable-track {
  height: 4px; background: var(--bg-3); border-radius: 99px;
}
.app-slider input[type=range]::-moz-range-track {
  height: 4px; background: var(--bg-3); border-radius: 99px;
}
.app-slider input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 22px; height: 22px;
  background: var(--accent); border-radius: 50%;
  border: 0; margin-top: -9px;
  box-shadow: var(--sh-1);
}
.app-slider input[type=range]::-moz-range-thumb {
  width: 22px; height: 22px;
  background: var(--accent); border-radius: 50%; border: 0;
  box-shadow: var(--sh-1);
}
```

- [ ] **Step 2: Create `client/src/ui/primitives/Slider.tsx`**

```tsx
interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  formatValue?: (v: number) => string;
  onChange: (v: number) => void;
  testId?: string;
}

export function Slider({ label, value, min, max, step = 1, formatValue, onChange, testId }: Props) {
  const display = formatValue ? formatValue(value) : String(value);
  return (
    <div className="app-slider">
      <div className="app-slider-label">
        <span>{label}</span>
        <span className="value">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        data-testid={testId}
      />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/primitives/Slider.tsx client/src/ui/primitives/primitives.css
git commit -m "feat(ui): Slider primitive with value bubble"
```

### Task 1.12: Build `SegmentedControl` primitive

**Files:**
- Create: `client/src/ui/primitives/SegmentedControl.tsx`
- Modify: `client/src/ui/primitives/primitives.css` (append segmented control styles)

- [ ] **Step 1: Append styles**

```css
.app-segmented {
  display: inline-flex;
  background: var(--bg-3);
  border-radius: var(--r-md);
  padding: 3px;
  gap: 2px;
}
.app-segmented button {
  flex: 1; min-height: 36px;
  background: transparent; color: var(--fg-muted);
  border: 0; border-radius: calc(var(--r-md) - 3px);
  padding: 4px 14px;
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-app), color var(--dur-fast) var(--ease-app);
  white-space: nowrap;
}
.app-segmented button[aria-pressed="true"] {
  background: var(--bg-1); color: var(--fg);
  box-shadow: var(--sh-1);
}
.app-segmented.full { display: flex; width: 100%; }
```

- [ ] **Step 2: Create `client/src/ui/primitives/SegmentedControl.tsx`**

```tsx
export interface SegmentOption<V extends string> {
  value: V;
  label: string;
}

interface Props<V extends string> {
  options: SegmentOption<V>[];
  value: V;
  onChange: (v: V) => void;
  fullWidth?: boolean;
  testId?: string;
}

export function SegmentedControl<V extends string>({
  options, value, onChange, fullWidth, testId,
}: Props<V>) {
  return (
    <div className={`app-segmented${fullWidth ? " full" : ""}`} data-testid={testId} role="radiogroup">
      {options.map((opt) => (
        <button
          key={opt.value}
          role="radio"
          aria-pressed={value === opt.value}
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          data-testid={testId ? `${testId}-${opt.value}` : undefined}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/primitives/SegmentedControl.tsx client/src/ui/primitives/primitives.css
git commit -m "feat(ui): SegmentedControl primitive"
```

### Task 1.13: Build `Carousel` primitive

**Files:**
- Create: `client/src/ui/primitives/Carousel.tsx`
- Modify: `client/src/ui/primitives/primitives.css` (append carousel styles)

- [ ] **Step 1: Append styles**

```css
.app-carousel-wrap { width: 100%; }
.app-carousel {
  display: flex; gap: 14px;
  overflow-x: auto; overflow-y: hidden;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  padding: 0 16px;
  scroll-padding-inline: 16px;
}
.app-carousel::-webkit-scrollbar { display: none; }
.app-carousel > * {
  scroll-snap-align: center;
  scroll-snap-stop: always;
  flex: 0 0 calc(100% - 32px);
}
.app-carousel-dots {
  display: flex; justify-content: center; gap: 6px;
  padding: 12px 0 4px;
}
.app-carousel-dots .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--fg-dim);
  transition: background var(--dur-fast) var(--ease-app),
              transform var(--dur-fast) var(--ease-app);
}
.app-carousel-dots .dot[data-active="true"] {
  background: var(--accent);
  transform: scale(1.3);
}
```

- [ ] **Step 2: Create `client/src/ui/primitives/Carousel.tsx`**

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  children: ReactNode[];     // one child per slide
  activeIndex?: number;
  onIndexChange?: (i: number) => void;
  ariaLabel: string;
  testId?: string;
}

export function Carousel({ children, activeIndex, onIndexChange, ariaLabel, testId }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [idx, setIdx] = useState(activeIndex ?? 0);

  // Update index based on scroll position.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const slideWidth = el.firstElementChild?.getBoundingClientRect().width ?? 1;
        const gap = parseFloat(getComputedStyle(el).gap || "0");
        const i = Math.round(el.scrollLeft / (slideWidth + gap));
        if (i !== idx) {
          setIdx(i);
          onIndexChange?.(i);
        }
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [idx, onIndexChange]);

  // External activeIndex prop → scroll to that slide.
  useEffect(() => {
    if (activeIndex === undefined) return;
    const el = ref.current;
    if (!el) return;
    const slideWidth = el.firstElementChild?.getBoundingClientRect().width ?? 1;
    const gap = parseFloat(getComputedStyle(el).gap || "0");
    el.scrollTo({ left: activeIndex * (slideWidth + gap), behavior: "smooth" });
  }, [activeIndex]);

  return (
    <div className="app-carousel-wrap" aria-label={ariaLabel} data-testid={testId}>
      <div className="app-carousel" ref={ref} role="region">
        {children.map((c, i) => <div key={i}>{c}</div>)}
      </div>
      <div className="app-carousel-dots" aria-hidden>
        {children.map((_, i) => (
          <div key={i} className="dot" data-active={i === idx || undefined} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/primitives/Carousel.tsx client/src/ui/primitives/primitives.css
git commit -m "feat(ui): Carousel primitive — snap-scroll + dots"
```

### Task 1.14: Build `StatusPill` primitive

**Files:**
- Create: `client/src/ui/primitives/StatusPill.tsx`
- Modify: `client/src/ui/primitives/primitives.css` (append pill styles)

- [ ] **Step 1: Append styles**

```css
.app-status-pill {
  position: fixed;
  top: calc(var(--safe-top) + 14px);
  left: 50%; transform: translateX(-50%);
  background: rgba(20,20,28,.78);
  backdrop-filter: blur(8px) saturate(160%);
  color: var(--fg);
  border-radius: 99px;
  padding: 6px 14px;
  font-size: 13px;
  display: inline-flex; align-items: center; gap: 8px;
  box-shadow: var(--sh-2);
  z-index: 110;
  opacity: 0;
  pointer-events: none;
  animation: pill-in var(--dur-base) var(--ease-app) forwards;
}
.app-status-pill[data-tone="warn"]    { color: #ffd76c; }
.app-status-pill[data-tone="danger"]  { color: var(--danger); }
.app-status-pill[data-tone="success"] { color: #4ade80; }
@keyframes pill-in {
  from { opacity: 0; transform: translate(-50%, -8px); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}
.app-status-pill .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: currentColor;
}
```

- [ ] **Step 2: Create `client/src/ui/primitives/StatusPill.tsx`**

```tsx
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  tone?: "default" | "warn" | "danger" | "success";
  showDot?: boolean;
  testId?: string;
}

export function StatusPill({ children, tone = "default", showDot, testId }: Props) {
  return (
    <div className="app-status-pill" data-tone={tone} role="status" data-testid={testId}>
      {showDot && <span className="dot" aria-hidden />}
      <span>{children}</span>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/primitives/StatusPill.tsx client/src/ui/primitives/primitives.css
git commit -m "feat(ui): StatusPill primitive"
```

### Task 1.15: Barrel-export the primitives

**Files:**
- Create: `client/src/ui/primitives/index.ts`

- [ ] **Step 1: Create the barrel**

```ts
export { Sheet } from "./Sheet";
export type { SheetState } from "./Sheet";
export { ActionSheet } from "./ActionSheet";
export type { ActionItem } from "./ActionSheet";
export { Modal } from "./Modal";
export { Prompt } from "./Prompt";
export { FAB } from "./FAB";
export { Slider } from "./Slider";
export { SegmentedControl } from "./SegmentedControl";
export type { SegmentOption } from "./SegmentedControl";
export { Carousel } from "./Carousel";
export { StatusPill } from "./StatusPill";
```

- [ ] **Step 2: Commit**

```bash
git add client/src/ui/primitives/index.ts
git commit -m "chore(ui): barrel-export primitives"
```

### Task 1.16: Add `/primitives` showcase route

**Files:**
- Create: `client/src/ui/PrimitivesShowcase.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Create the showcase page**

```tsx
import { useState } from "react";
import {
  Sheet, ActionSheet, Modal, Prompt, FAB,
  Slider, SegmentedControl, Carousel, StatusPill,
  type SheetState,
} from "./primitives";

export function PrimitivesShowcase() {
  const [sheetState, setSheetState] = useState<SheetState>("peek");
  const [actionOpen, setActionOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [sliderValue, setSliderValue] = useState(50);
  const [segValue, setSegValue] = useState<"a" | "b" | "c">("a");

  return (
    <div style={{ padding: 20, color: "var(--fg)", background: "var(--bg-0)", minHeight: "100vh" }}>
      <h1>Primitives showcase</h1>
      <p>Manually verify each primitive renders + behaves correctly.</p>

      <h2>SegmentedControl</h2>
      <SegmentedControl
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
          { value: "c", label: "Gamma" },
        ]}
        value={segValue}
        onChange={setSegValue}
        fullWidth
      />

      <h2 style={{ marginTop: 24 }}>Slider</h2>
      <Slider
        label="Opacity"
        value={sliderValue}
        min={0}
        max={100}
        onChange={setSliderValue}
        formatValue={(v) => `${v}%`}
      />

      <h2 style={{ marginTop: 24 }}>StatusPill</h2>
      <StatusPill tone="success" showDot>Connected</StatusPill>

      <h2 style={{ marginTop: 60 }}>Buttons opening overlays</h2>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => setActionOpen(true)}>Open ActionSheet</button>
        <button onClick={() => setModalOpen(true)}>Open Modal</button>
        <button onClick={() => setPromptOpen(true)}>Open Prompt</button>
        <button onClick={() => setSheetState("expanded")}>Expand Sheet</button>
      </div>

      <h2 style={{ marginTop: 24 }}>Carousel</h2>
      <Carousel ariaLabel="Demo carousel">
        {["red", "blue", "green", "purple"].map((c) => (
          <div key={c} style={{ height: 160, background: c, borderRadius: 18 }} />
        ))}
      </Carousel>

      <FAB ariaLabel="Add" onClick={() => alert("FAB tapped")}>+</FAB>

      <Sheet state={sheetState} onStateChange={setSheetState} peekHeight={60}>
        <div style={{ padding: 12 }}>
          <h3>Sheet body</h3>
          <p>Drag the handle to switch between peek and expanded.</p>
          <button onClick={() => setSheetState("closed")}>Close</button>
        </div>
      </Sheet>

      <ActionSheet
        open={actionOpen}
        title="Choose an action"
        items={[
          { label: "Rename…", onSelect: () => console.log("rename") },
          { label: "Archive", onSelect: () => console.log("archive") },
          { label: "Delete forever", onSelect: () => console.log("delete"), destructive: true },
        ]}
        onClose={() => setActionOpen(false)}
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)}>
        <h1>I'm a modal</h1>
        <p>Press Esc or tap the button to close.</p>
        <button onClick={() => setModalOpen(false)}>Close</button>
      </Modal>

      <Prompt
        open={promptOpen}
        title="What's your favorite GBA game?"
        placeholder="e.g. Pokémon Emerald"
        onSubmit={(v) => { console.log("submitted", v); setPromptOpen(false); }}
        onCancel={() => setPromptOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Wire the route into `App.tsx`**

Edit `client/src/App.tsx`:

```tsx
import { useRoute } from "./lib/router";
import { HomePage } from "./ui/HomePage";
import { PlayPage } from "./ui/PlayPage";
import { SessionPage } from "./ui/SessionPage";
import { SpikePage } from "./spike/SpikePage";
import { PrimitivesShowcase } from "./ui/PrimitivesShowcase";

export function App() {
  const route = useRoute();
  if (route.path === "/spike") return <SpikePage />;
  if (route.path === "/play") return <PlayPage />;
  if (route.path === "/primitives") return <PrimitivesShowcase />;
  if (route.path.startsWith("/s/")) return <SessionPage />;
  return <HomePage />;
}
```

- [ ] **Step 3: Manual smoke test**

```bash
npm run dev
```

Visit http://localhost:5173/primitives. Verify:
- Segmented control responds and shows the active selection.
- Slider drags smoothly.
- Each "Open …" button shows the matching overlay.
- Sheet drags between peek and expanded.
- Carousel snaps between slides and dot indicator follows.
- FAB sits bottom-right with safe-area inset (visible in iPhone DevTools profile).

Take a screenshot via Playwright MCP and visually compare with the design tokens.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/PrimitivesShowcase.tsx client/src/App.tsx
git commit -m "chore(ui): /primitives showcase for manual primitive verification"
```

### Task 1.17: M1 closing — run all tests and typecheck

- [ ] **Step 1: Run the full test suite**

```bash
npm --workspace client run test
```

Expected: all primitive + hook tests pass.

- [ ] **Step 2: Run the typecheck**

```bash
npm run typecheck
```

Expected: no errors across client/server/shared.

- [ ] **Step 3: Build the client to confirm bundling works**

```bash
npm --workspace client run build
```

Expected: build succeeds; no TypeScript errors.

M1 is complete. The app is functionally unchanged for end users (Home, Play, Spike still render the legacy UI), but the primitives library, design tokens, and test harness are now in place.

---

## Milestone M2 — Settings storage + `/settings` page

**Goal at end of M2:** `localStorage` holds `settings.global` and `settings.rom.<romId>` JSON blobs; a `resolveSettings(romId)` function returns the merged effective settings; `/settings` is a real page with Player, Defaults, Archived, About sections; the existing in-game `<SettingsMenu>` is still untouched (replaced in M4). The "Customize default button layout…" row exists but is wired to a stub that says "Available in next milestone" — wiring lands in M5.

### Task 2.1: Rewrite `lib/settings.ts` with the new tiered model

**Files:**
- Modify: `client/src/lib/settings.ts`
- Create: `client/src/lib/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `client/src/lib/settings.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadGlobal, saveGlobal,
  loadRom, saveRom, clearRom,
  resolveSettings,
  listRomOverrides,
  DEFAULT_SETTINGS,
} from "./settings";

describe("settings storage", () => {
  beforeEach(() => localStorage.clear());

  it("returns DEFAULT_SETTINGS when global is empty", () => {
    expect(loadGlobal()).toEqual(DEFAULT_SETTINGS);
  });

  it("migrates legacy settings.controlLayout into settings.global on first read", () => {
    localStorage.setItem("settings.controlLayout", "overlay");
    const g = loadGlobal();
    expect(g.controlLayout).toBe("overlay");
    // Legacy key removed.
    expect(localStorage.getItem("settings.controlLayout")).toBeNull();
    // New key written.
    expect(JSON.parse(localStorage.getItem("settings.global")!).controlLayout).toBe("overlay");
  });

  it("saveGlobal persists and loadGlobal reads back", () => {
    saveGlobal({ ...DEFAULT_SETTINGS, haptics: "strong" });
    expect(loadGlobal().haptics).toBe("strong");
  });

  it("loadRom returns empty object when no override exists", () => {
    expect(loadRom("emerald.gba")).toEqual({});
  });

  it("saveRom only persists explicitly set keys", () => {
    saveRom("emerald.gba", { speedDefault: 2 });
    expect(loadRom("emerald.gba")).toEqual({ speedDefault: 2 });
  });

  it("clearRom removes the per-rom entry", () => {
    saveRom("emerald.gba", { speedDefault: 2 });
    clearRom("emerald.gba");
    expect(loadRom("emerald.gba")).toEqual({});
    expect(localStorage.getItem("settings.rom.emerald.gba")).toBeNull();
  });

  it("resolveSettings cascades rom > global > defaults", () => {
    saveGlobal({ ...DEFAULT_SETTINGS, controlLayout: "stacked", haptics: "off" });
    saveRom("emerald.gba", { controlLayout: "overlay" });
    const r = resolveSettings("emerald.gba");
    expect(r.controlLayout).toBe("overlay");  // from per-rom
    expect(r.haptics).toBe("off");            // from global
  });

  it("resolveSettings uses defaults when given a null romId", () => {
    saveGlobal({ ...DEFAULT_SETTINGS, controlLayout: "flanking" });
    const r = resolveSettings(null);
    expect(r.controlLayout).toBe("flanking");
  });

  it("listRomOverrides returns rom ids with stored overrides", () => {
    saveRom("emerald.gba", { speedDefault: 2 });
    saveRom("zelda.gba", { startMuted: false });
    const ids = listRomOverrides();
    expect(ids.sort()).toEqual(["emerald.gba", "zelda.gba"]);
  });
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

```bash
npm --workspace client run test -- settings
```

Expected: FAIL on every new function (they don't exist yet).

- [ ] **Step 3: Rewrite `client/src/lib/settings.ts`**

```ts
// Tiered settings model:
//   • Global defaults — settings.global (localStorage JSON).
//   • Per-ROM overrides — settings.rom.<romId> (localStorage JSON).
//   • Session-only overrides — held in memory by the consumer.
//
// resolveSettings(romId) returns the effective settings by cascading
// rom > global > built-in defaults.

import { useEffect, useState } from "react";

export type ControlLayout = "stacked" | "flanking" | "overlay";
export type HapticsMode = "off" | "light" | "strong";

export interface ButtonLayout {
  schemaVersion: 1;
  orientations: {
    portrait: OrientationLayout;
    landscape: OrientationLayout;
  };
}
export interface OrientationLayout {
  buttons: Record<ButtonId, { x: number; y: number; size: number }>;
  opacity: number; // 0.3 – 1.0
}
export type ButtonId = "dpad" | "a" | "b" | "l" | "r" | "start" | "select";

export interface GlobalSettings {
  controlLayout: ControlLayout | "auto"; // "auto" => orientation-driven
  buttonLayout: ButtonLayout | null;     // null => built-in baseline
  haptics: HapticsMode;
  soundFeedback: boolean;
}

export interface RomSettings {
  controlLayout?: ControlLayout | "auto";
  buttonLayout?: ButtonLayout;
  speedDefault?: number;        // 1 / 2 / 4 / 8
  startMuted?: boolean;
  haptics?: HapticsMode;
}

export interface ResolvedSettings {
  controlLayout: ControlLayout | "auto";
  buttonLayout: ButtonLayout | null;
  haptics: HapticsMode;
  soundFeedback: boolean;
  speedDefault: number;
  startMuted: boolean;
}

export const DEFAULT_SETTINGS: GlobalSettings = {
  controlLayout: "auto",
  buttonLayout: null,
  haptics: "light",
  soundFeedback: false,
};

const GLOBAL_KEY = "settings.global";
const ROM_PREFIX = "settings.rom.";
const LEGACY_LAYOUT_KEY = "settings.controlLayout";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch { return fallback; }
}

export function loadGlobal(): GlobalSettings {
  // One-shot migration from the legacy single-key store.
  const legacy = localStorage.getItem(LEGACY_LAYOUT_KEY);
  if (legacy === "stacked" || legacy === "flanking" || legacy === "overlay") {
    const existing = readJson<GlobalSettings>(GLOBAL_KEY, DEFAULT_SETTINGS);
    const merged: GlobalSettings = { ...existing, controlLayout: legacy };
    localStorage.setItem(GLOBAL_KEY, JSON.stringify(merged));
    localStorage.removeItem(LEGACY_LAYOUT_KEY);
    return merged;
  }
  return readJson<GlobalSettings>(GLOBAL_KEY, DEFAULT_SETTINGS);
}

export function saveGlobal(s: GlobalSettings): void {
  localStorage.setItem(GLOBAL_KEY, JSON.stringify(s));
}

export function loadRom(romId: string): RomSettings {
  return readJson<RomSettings>(ROM_PREFIX + romId, {});
}

export function saveRom(romId: string, s: RomSettings): void {
  localStorage.setItem(ROM_PREFIX + romId, JSON.stringify(s));
}

export function clearRom(romId: string): void {
  localStorage.removeItem(ROM_PREFIX + romId);
}

export function listRomOverrides(): string[] {
  const ids: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(ROM_PREFIX)) ids.push(k.slice(ROM_PREFIX.length));
  }
  return ids;
}

export function resolveSettings(romId: string | null): ResolvedSettings {
  const g = loadGlobal();
  const r = romId ? loadRom(romId) : {};
  return {
    controlLayout: r.controlLayout ?? g.controlLayout,
    buttonLayout: r.buttonLayout ?? g.buttonLayout,
    haptics: r.haptics ?? g.haptics,
    soundFeedback: g.soundFeedback,
    speedDefault: r.speedDefault ?? 1,
    startMuted: r.startMuted ?? true,
  };
}

// Resolve "auto" → concrete layout based on orientation.
export function effectiveControlLayout(
  setting: ControlLayout | "auto",
  isLandscape: boolean,
): ControlLayout {
  if (setting === "auto") return isLandscape ? "flanking" : "stacked";
  return setting;
}

export function useOrientation(): boolean {
  const isLandscape = () => window.matchMedia("(orientation: landscape)").matches;
  const [v, setV] = useState<boolean>(isLandscape);
  useEffect(() => {
    const mm = window.matchMedia("(orientation: landscape)");
    const onChange = () => setV(mm.matches);
    mm.addEventListener?.("change", onChange);
    window.addEventListener("resize", onChange);
    return () => {
      mm.removeEventListener?.("change", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, []);
  return v;
}

// Convenience hook for the in-game session: read the live-resolved layout
// for the current rom, updating when the user changes the setting.
export function useResolvedSettings(romId: string | null): ResolvedSettings {
  const [resolved, setResolved] = useState<ResolvedSettings>(() => resolveSettings(romId));
  useEffect(() => {
    setResolved(resolveSettings(romId));
    const onStorage = (e: StorageEvent) => {
      if (e.key === GLOBAL_KEY || e.key === ROM_PREFIX + romId) {
        setResolved(resolveSettings(romId));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [romId]);
  return resolved;
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

```bash
npm --workspace client run test -- settings
```

Expected: PASS (9 tests).

- [ ] **Step 5: Verify legacy `SettingsMenu.tsx` and `SessionPage.tsx` still typecheck**

The old `useControlLayout()` and `resolveLayout()` exports are gone. Update the legacy callers to use the new API:

In `client/src/ui/SettingsMenu.tsx` line 5, replace:
```tsx
import type { ControlLayout } from "../lib/settings";
import { resolveLayout, useOrientation } from "../lib/settings";
```
with:
```tsx
import type { ControlLayout } from "../lib/settings";
import { effectiveControlLayout, useOrientation } from "../lib/settings";
```
and on line 23 change:
```tsx
const autoResolved = resolveLayout(null, isLandscape);
```
to:
```tsx
const autoResolved = effectiveControlLayout("auto", isLandscape);
```

In `client/src/ui/SessionPage.tsx` line 24, replace:
```tsx
import { useControlLayout } from "../lib/settings";
```
with:
```tsx
import { effectiveControlLayout, loadGlobal, useOrientation, type ControlLayout } from "../lib/settings";
```
and replace the use site (line 108) with:
```tsx
const isLandscape = useOrientation();
const [layoutPref, setLayoutPref] = useState<ControlLayout | null>(() => {
  const g = loadGlobal();
  return g.controlLayout === "auto" ? null : g.controlLayout;
});
const layout = layoutPref ?? effectiveControlLayout("auto", isLandscape);
```

(This keeps the legacy SessionPage rendering identically until M4 rewrites it.)

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
```

Expected: no errors.

```bash
git add client/src/lib/settings.ts client/src/lib/settings.test.ts client/src/ui/SettingsMenu.tsx client/src/ui/SessionPage.tsx
git commit -m "feat(settings): tiered global/per-rom store with resolution + migration"
```

### Task 2.2: Add the player-name helpers + small `useGlobalSettings` hook

**Files:**
- Modify: `client/src/lib/settings.ts` (add hook)

- [ ] **Step 1: Append a `useGlobalSettings` hook at the bottom of `client/src/lib/settings.ts`**

```ts
export function useGlobalSettings(): {
  settings: GlobalSettings;
  setSettings: (next: GlobalSettings) => void;
  patch: (delta: Partial<GlobalSettings>) => void;
} {
  const [settings, setS] = useState<GlobalSettings>(loadGlobal);
  const setSettings = (next: GlobalSettings) => { saveGlobal(next); setS(next); };
  const patch = (delta: Partial<GlobalSettings>) => setSettings({ ...settings, ...delta });
  return { settings, setSettings, patch };
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/lib/settings.ts
git commit -m "feat(settings): useGlobalSettings hook for write-through patches"
```

### Task 2.3: Create the SettingsPage skeleton and route

**Files:**
- Create: `client/src/ui/SettingsPage.tsx`
- Create: `client/src/ui/settings.css`
- Modify: `client/src/App.tsx`
- Modify: `client/src/main.tsx`

- [ ] **Step 1: Create `client/src/ui/settings.css`**

```css
.settings-shell {
  min-height: 100dvh;
  background: var(--bg-0); color: var(--fg);
  padding: calc(var(--safe-top) + 12px) 0 calc(var(--safe-bottom) + 24px);
}
.settings-inner { max-width: 720px; margin: 0 auto; padding: 0 16px; }

.settings-header {
  display: flex; align-items: center; gap: 12px;
  margin-bottom: 18px;
}
.settings-header h1 { font-size: 20px; margin: 0; flex: 1; }
.settings-header .back {
  background: var(--bg-2); color: var(--fg);
  width: 36px; height: 36px; border-radius: 50%;
  border: 0; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}

.settings-section {
  background: var(--bg-1);
  border-radius: var(--r-lg);
  margin-bottom: 16px;
  overflow: hidden;
}
.settings-section h2 {
  font-size: 13px; text-transform: uppercase; letter-spacing: .06em;
  color: var(--fg-muted); margin: 0;
  padding: 14px 16px 6px;
}
.settings-row {
  display: flex; align-items: center; gap: 12px;
  min-height: var(--tap-min);
  padding: 12px 16px;
  cursor: pointer;
  border: 0; background: transparent; color: var(--fg);
  width: 100%;
  text-align: left;
}
.settings-row + .settings-row { border-top: 1px solid var(--bg-2); }
.settings-row .label { flex: 1; }
.settings-row .value { color: var(--fg-muted); font-size: 13px; }
.settings-row .chevron { color: var(--fg-dim); }
.settings-row.toggle .value { color: var(--accent); }

.settings-row .segmented-wrap { margin-left: auto; }
```

- [ ] **Step 2: Import `settings.css` in `main.tsx`**

```tsx
import "./ui/tokens.css";
import "./ui/primitives/primitives.css";
import "./ui/styles.css";
import "./ui/settings.css";
```

- [ ] **Step 3: Create the SettingsPage skeleton**

Create `client/src/ui/SettingsPage.tsx`:

```tsx
import { useState } from "react";
import { navigate } from "../lib/router";
import { useGlobalSettings, type ControlLayout, type HapticsMode } from "../lib/settings";
import { getPlayerName, setPlayerName } from "../lib/player";
import { Avatar } from "./Avatar";
import { Prompt, SegmentedControl } from "./primitives";
import { IconBack } from "./icons";

export function SettingsPage() {
  const { settings, patch } = useGlobalSettings();
  const [name, setName] = useState<string>(getPlayerName);
  const [editingName, setEditingName] = useState(false);

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

        {/* ===== Archived (placeholder — wired in Task 2.5) ===== */}
        <section className="settings-section">
          <h2>Archived saves</h2>
          <div className="settings-row">
            <span className="label" style={{ color: "var(--fg-muted)" }}>Loading…</span>
          </div>
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
    </div>
  );
}
```

- [ ] **Step 4: Wire route in `App.tsx`**

```tsx
import { useRoute } from "./lib/router";
import { HomePage } from "./ui/HomePage";
import { PlayPage } from "./ui/PlayPage";
import { SessionPage } from "./ui/SessionPage";
import { SpikePage } from "./spike/SpikePage";
import { PrimitivesShowcase } from "./ui/PrimitivesShowcase";
import { SettingsPage } from "./ui/SettingsPage";

export function App() {
  const route = useRoute();
  if (route.path === "/spike") return <SpikePage />;
  if (route.path === "/play") return <PlayPage />;
  if (route.path === "/primitives") return <PrimitivesShowcase />;
  if (route.path === "/settings") return <SettingsPage />;
  if (route.path.startsWith("/s/")) return <SessionPage />;
  return <HomePage />;
}
```

- [ ] **Step 5: Smoke test**

```bash
npm run dev
```

Visit http://localhost:5173/settings. Confirm:
- Page renders with header, Player row, Defaults section, Archived placeholder, About section.
- Tapping the Player row opens the Prompt sheet; typing + Save updates the name shown.
- Segmented controls for Control layout and Haptics select correctly.
- Sound feedback row toggles.
- Build SHA link opens GitHub commit.

- [ ] **Step 6: Commit**

```bash
git add client/src/ui/SettingsPage.tsx client/src/ui/settings.css client/src/App.tsx client/src/main.tsx
git commit -m "feat(ui): /settings page — player, defaults, archived placeholder, about"
```

### Task 2.4: Per-game customizations sub-page

**Files:**
- Create: `client/src/ui/PerGameSettingsPage.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Create the sub-page**

`client/src/ui/PerGameSettingsPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { listRoms, type RomMeta } from "../lib/api";
import { listRomOverrides, clearRom } from "../lib/settings";
import { navigate } from "../lib/router";
import { ActionSheet, type ActionItem } from "./primitives";
import { IconBack } from "./icons";

export function PerGameSettingsPage() {
  const [roms, setRoms] = useState<RomMeta[]>([]);
  const [overrides, setOverrides] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rowMenuFor, setRowMenuFor] = useState<string | null>(null);

  const refresh = () => setOverrides(listRomOverrides());

  useEffect(() => {
    listRoms().then(setRoms).catch(() => {});
    refresh();
  }, []);

  const romName = (id: string) => roms.find((r) => r.id === id)?.name ?? id;

  const pickerItems: ActionItem[] = roms.map((r) => ({
    label: r.name,
    onSelect: () => navigate(`/edit-controls?scope=rom:${encodeURIComponent(r.id)}`),
    testId: `pick-rom-${r.id}`,
  }));

  return (
    <div className="settings-shell">
      <div className="settings-inner">
        <div class-name="settings-header">
          <button className="back" onClick={() => navigate("/settings")} aria-label="Back">
            <IconBack size={14} />
          </button>
          <h1>Per-game customizations</h1>
        </div>

        <section className="settings-section">
          {overrides.length === 0 ? (
            <div className="settings-row" style={{ color: "var(--fg-muted)" }}>
              No per-game customizations yet.
            </div>
          ) : overrides.map((id) => (
            <button
              key={id}
              className="settings-row"
              onClick={() => setRowMenuFor(id)}
              data-testid={`override-row-${id}`}
            >
              <span className="label">{romName(id)}</span>
              <span className="chevron">›</span>
            </button>
          ))}
          <button
            className="settings-row"
            onClick={() => setPickerOpen(true)}
            data-testid="add-override"
            style={{ color: "var(--accent)" }}
          >
            <span className="label">+ Customize another game</span>
          </button>
        </section>
      </div>

      <ActionSheet
        open={pickerOpen}
        title="Choose a game"
        items={pickerItems}
        onClose={() => setPickerOpen(false)}
      />

      <ActionSheet
        open={rowMenuFor !== null}
        title={rowMenuFor ? romName(rowMenuFor) : ""}
        items={rowMenuFor ? [
          {
            label: "Modify…",
            trailing: "chevron",
            onSelect: () => navigate(`/edit-controls?scope=rom:${encodeURIComponent(rowMenuFor!)}`),
          },
          {
            label: "Reset to defaults",
            destructive: true,
            onSelect: () => { clearRom(rowMenuFor!); refresh(); },
          },
        ] : []}
        onClose={() => setRowMenuFor(null)}
      />
    </div>
  );
}
```

Fix the typo: change `class-name` to `className` on the header div.

- [ ] **Step 2: Wire route in `App.tsx`**

Add before the `/settings` route check (since `/settings/per-game` would otherwise match `/settings` first):

```tsx
if (route.path === "/settings/per-game") return <PerGameSettingsPage />;
if (route.path === "/settings") return <SettingsPage />;
```

And add the import:
```tsx
import { PerGameSettingsPage } from "./ui/PerGameSettingsPage";
```

- [ ] **Step 3: Smoke test**

Visit `/settings/per-game`. Confirm:
- Empty state shows "No per-game customizations yet."
- "+ Customize another game" opens an action sheet listing ROMs.
- Tapping a ROM navigates to `/edit-controls?scope=rom:<id>` (404s for now; M5 implements).

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/PerGameSettingsPage.tsx client/src/App.tsx
git commit -m "feat(ui): /settings/per-game — list overrides + ROM picker"
```

### Task 2.5: Wire the Archived saves section

**Files:**
- Modify: `client/src/ui/SettingsPage.tsx`

- [ ] **Step 1: Replace the Archived placeholder with the live list**

In `client/src/ui/SettingsPage.tsx`, add at the top of the component (after the existing state):

```tsx
import { useEffect } from "react";
import { listSaves, archiveSave, unarchiveSave, renameSave, deleteSave } from "../lib/api";
import type { SaveSummary } from "@gba/shared";
import { ActionSheet, type ActionItem } from "./primitives";

// ... inside the component body:
const [saves, setSaves] = useState<SaveSummary[]>([]);
const [rowMenuFor, setRowMenuFor] = useState<SaveSummary | null>(null);
const [renaming, setRenaming] = useState<SaveSummary | null>(null);

const refresh = () => listSaves().then(setSaves).catch(() => {});
useEffect(() => { refresh(); }, []);
const archived = saves.filter((s) => s.archived);
```

Replace the placeholder Archived section JSX with:

```tsx
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
```

Add the action sheet for the row menu (just before the closing `</div>` of `.settings-shell`):

```tsx
<ActionSheet
  open={rowMenuFor !== null}
  title={rowMenuFor?.name}
  items={rowMenuFor ? [
    { label: "Restore", onSelect: async () => { await unarchiveSave(rowMenuFor.id); refresh(); }, testId: "act-restore" },
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
      onSelect: async () => { await deleteSave(rowMenuFor.id); refresh(); },
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
    setRenaming(null); refresh();
  }}
  onCancel={() => setRenaming(null)}
/>
```

- [ ] **Step 2: Smoke test**

Archive a save from the (still-legacy) home page, navigate to `/settings`, confirm it shows under Archived. Tap the row — the action sheet should offer Restore/Rename/Download/Delete. Confirm Restore returns it to Home's active list.

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/SettingsPage.tsx
git commit -m "feat(settings): wire archived saves list with restore/rename/download/delete"
```

### Task 2.6: M2 closing — typecheck, build, screenshot

- [ ] **Step 1: Run tests + typecheck + build**

```bash
npm --workspace client run test
npm run typecheck
npm --workspace client run build
```

Expected: all pass.

- [ ] **Step 2: Visual confirmation**

Run `npm run dev`, open Playwright MCP, navigate to `/settings`, take a screenshot. Compare against the design spec §6 — sections in the order Player → Defaults → Archived → About, segmented controls visible, no `window.confirm` invoked when archiving/deleting from Settings.

M2 is complete: settings storage is in place, the new `/settings` page is reachable, per-game customization scaffolding exists (the actual editor lands in M5). The legacy Home and Session screens still render today's UI; they get rewritten in M3 and M4.

---

## Milestone M3 — Home rewrite

**Goal at end of M3:** `/` renders the new touch-first home: avatar (left) + install pill + gear (right) on the top bar, swipeable carousel of saves (or empty-state card), FAB to create, long-press for actions, name-tinted gradient backgrounds per save, footer with spike + build-SHA links. Onboarding is a full-screen modal for first-time users. No `window.confirm` / `window.prompt` on this surface.

### Task 3.1: Add the gradient helper

**Files:**
- Create: `client/src/lib/gradient.ts`
- Create: `client/src/lib/gradient.test.ts`

- [ ] **Step 1: Write the failing test**

`client/src/lib/gradient.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { gradientForName } from "./gradient";

describe("gradientForName", () => {
  it("returns a CSS linear-gradient string", () => {
    const g = gradientForName("Emerald");
    expect(g).toMatch(/^linear-gradient\(/);
  });
  it("is deterministic for the same input", () => {
    expect(gradientForName("Emerald")).toBe(gradientForName("Emerald"));
  });
  it("differs for different inputs", () => {
    expect(gradientForName("Emerald")).not.toBe(gradientForName("Sapphire"));
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
npm --workspace client run test -- gradient
```

Expected: FAIL — `Cannot find module './gradient'`.

- [ ] **Step 3: Implement**

```ts
// Deterministic gradient from a name. Hash → two hues 30° apart.

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function gradientForName(name: string): string {
  const h = hash32(name || "?");
  const hueA = h % 360;
  const hueB = (hueA + 35) % 360;
  return `linear-gradient(135deg, hsl(${hueA}, 50%, 22%) 0%, hsl(${hueB}, 60%, 14%) 100%)`;
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
npm --workspace client run test -- gradient
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/gradient.ts client/src/lib/gradient.test.ts
git commit -m "feat(ui): deterministic gradient helper for save cards"
```

### Task 3.2: Create the new HomePage stylesheet

**Files:**
- Create: `client/src/ui/home.css`
- Modify: `client/src/main.tsx`

- [ ] **Step 1: Create `client/src/ui/home.css`**

```css
.home-v2 {
  min-height: 100dvh;
  background: var(--bg-0); color: var(--fg);
  display: flex; flex-direction: column;
  padding-top: var(--safe-top);
}

.home-v2-topbar {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px;
}
.home-v2-topbar .avatar-btn {
  background: transparent; border: 0; padding: 0;
  display: inline-flex; align-items: center;
  cursor: pointer;
}
.home-v2-topbar .spacer { flex: 1; }
.home-v2-topbar .pill,
.home-v2-topbar .gear {
  min-height: 36px;
  border-radius: 99px;
  border: 0; padding: 6px 14px;
  background: var(--bg-1); color: var(--fg);
  font-size: 13px; font-weight: 600;
  cursor: pointer;
}
.home-v2-topbar .gear {
  width: 36px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
}

.home-v2-carousel-wrap { flex: 1; display: flex; flex-direction: column; justify-content: center; min-height: 0; }

.save-card-v2 {
  display: flex; flex-direction: column;
  height: 64dvh;
  border-radius: var(--r-xl);
  padding: 18px;
  color: var(--fg);
  box-shadow: var(--sh-3);
  position: relative;
  overflow: hidden;
}
.save-card-v2 .rom-chip {
  align-self: flex-start;
  font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
  background: rgba(255,255,255,.12); color: var(--fg);
  padding: 4px 10px; border-radius: 99px;
}
.save-card-v2 .title {
  font-size: 26px; font-weight: 700; line-height: 1.1;
  margin: 12px 0 6px;
}
.save-card-v2 .meta {
  font-size: 13px; color: rgba(255,255,255,.78);
}
.save-card-v2 .live-row {
  display: flex; align-items: center; gap: 6px;
  margin-top: 8px;
  font-size: 12px; color: #4ade80;
}
.save-card-v2 .live-row .dot { width: 7px; height: 7px; background: currentColor; border-radius: 50%; }
.save-card-v2 .contribs {
  display: flex; gap: 6px; flex-wrap: wrap; margin-top: 14px;
}
.save-card-v2 .contribs .chip {
  background: rgba(0,0,0,.35); color: var(--fg);
  border-radius: 99px; padding: 3px 8px 3px 4px;
  font-size: 11px;
  display: inline-flex; align-items: center; gap: 6px;
}
.save-card-v2 .play-cta {
  margin-top: auto;
  background: rgba(255,255,255,.18);
  color: var(--fg);
  border: 0; border-radius: var(--r-lg);
  padding: 14px;
  font-size: 17px; font-weight: 700;
  cursor: pointer;
  backdrop-filter: blur(8px);
}
.save-card-v2.empty {
  background: transparent !important;
  border: 2px dashed var(--bg-3);
  display: flex; align-items: center; justify-content: center;
  color: var(--fg-muted);
  font-size: 16px;
}

.home-v2-footer {
  display: flex; gap: 14px; justify-content: center;
  padding: 8px 16px calc(var(--safe-bottom) + 12px);
  color: var(--fg-dim); font-size: 11px;
}
.home-v2-footer a { color: var(--fg-dim); text-decoration: none; }
.home-v2-footer a:hover { color: var(--fg-muted); }
```

- [ ] **Step 2: Import in `main.tsx`**

After `settings.css`, add:
```tsx
import "./ui/home.css";
```

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/home.css client/src/main.tsx
git commit -m "feat(ui): home stylesheet for the carousel layout"
```

### Task 3.3: Rewrite `HomePage.tsx` — top bar, carousel, FAB, action sheet

**Files:**
- Modify: `client/src/ui/HomePage.tsx` (full rewrite)
- Modify: `client/src/ui/InstallButton.tsx` (re-theme to fit top bar)

- [ ] **Step 1: Inspect the current InstallButton to make a minimal-impact change**

```bash
cat client/src/ui/InstallButton.tsx
```

Update only its outer class so it can be styled by `.home-v2-topbar .pill`. Replace the root element's className with `"home-v2-topbar pill app-install-pill"`. Keep all logic and the `data-testid` exactly as-is. (Exact diff depends on current source; the rule is "outer className uses the top-bar pill style.")

- [ ] **Step 2: Rewrite `client/src/ui/HomePage.tsx`**

```tsx
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
import { IconGear } from "./icons";

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

  // ---- Bootstraps ----
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

  // ---- Actions ----
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

  // Onboarding shows when the player has no name yet.
  if (!nameOk) {
    return <OnboardingModal
      roms={roms ?? []}
      onCommit={(playerName, saveName, romId) => {
        setPlayerName(playerName);
        setName(playerName);
        createSave({ name: saveName, romId }).then((s) => navigate(`/s/${s.id}`));
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
          <IconGear size={16} />
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

      {/* ---- Sheets ---- */}
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
```

- [ ] **Step 3: Add an `IconGear` to `icons.tsx`**

In `client/src/ui/icons.tsx`, append:

```tsx
export function IconGear({ size = 16, ...rest }: { size?: number } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" {...rest}>
      <path d="M9.405 1.05a1 1 0 0 0-1.81 0l-.39.91a1 1 0 0 1-1.32.52l-.93-.38a1 1 0 0 0-1.28 1.28l.38.93a1 1 0 0 1-.52 1.32l-.91.39a1 1 0 0 0 0 1.81l.91.39a1 1 0 0 1 .52 1.32l-.38.93a1 1 0 0 0 1.28 1.28l.93-.38a1 1 0 0 1 1.32.52l.39.91a1 1 0 0 0 1.81 0l.39-.91a1 1 0 0 1 1.32-.52l.93.38a1 1 0 0 0 1.28-1.28l-.38-.93a1 1 0 0 1 .52-1.32l.91-.39a1 1 0 0 0 0-1.81l-.91-.39a1 1 0 0 1-.52-1.32l.38-.93a1 1 0 0 0-1.28-1.28l-.93.38a1 1 0 0 1-1.32-.52l-.39-.91ZM8 10.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"/>
    </svg>
  );
}
```

- [ ] **Step 4: Commit (will not compile yet — OnboardingModal lands next task)**

```bash
git add client/src/ui/HomePage.tsx client/src/ui/icons.tsx client/src/ui/InstallButton.tsx
git commit -m "feat(home): carousel layout, FAB, long-press action sheet (wip — onboarding next)"
```

### Task 3.4: Onboarding modal

**Files:**
- Create: `client/src/ui/OnboardingModal.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useState } from "react";
import { Modal } from "./primitives";
import type { RomMeta } from "../lib/api";

interface Props {
  roms: RomMeta[];
  onCommit: (playerName: string, saveName: string, romId: string) => void;
}

export function OnboardingModal({ roms, onCommit }: Props) {
  const [step, setStep] = useState(0);
  const [playerName, setPlayerName] = useState("");
  const [saveName, setSaveName] = useState("");
  const [romId, setRomId] = useState(roms[0]?.id ?? "");

  const next = () => setStep((s) => Math.min(2, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  const canStep0 = playerName.trim().length > 0;
  const canStep2 = saveName.trim().length > 0 && romId.length > 0;

  return (
    <Modal open>
      <div style={{ maxWidth: 520, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24, minHeight: "85dvh" }}>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 24 }}>
          {[0, 1, 2].map((i) => (
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
          {step === 2 && (
            <>
              <h1 style={{ fontSize: 28, marginBottom: 8 }}>Start your first save</h1>
              <p style={{ color: "var(--fg-muted)", marginBottom: 18 }}>
                Pick a ROM and give the save a name. You can change everything later.
              </p>
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Save name, e.g. Emerald run"
                maxLength={64}
                style={{
                  background: "var(--bg-2)", color: "var(--fg)", border: 0,
                  borderRadius: "var(--r-md)", padding: "12px 14px", fontSize: 16, marginBottom: 10,
                }}
                data-testid="onboard-save-name"
              />
              <select
                value={romId}
                onChange={(e) => setRomId(e.target.value)}
                style={{
                  background: "var(--bg-2)", color: "var(--fg)", border: 0,
                  borderRadius: "var(--r-md)", padding: "12px 14px", fontSize: 16,
                }}
                data-testid="onboard-rom"
              >
                {roms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
          {step > 0 && <button onClick={back} style={{ flex: 1, padding: 14, borderRadius: "var(--r-md)", background: "var(--bg-2)", color: "var(--fg)", border: 0 }}>Back</button>}
          {step < 2 ? (
            <button
              onClick={next}
              disabled={step === 0 && !canStep0}
              style={{ flex: 2, padding: 14, borderRadius: "var(--r-md)", background: "var(--accent)", color: "var(--accent-on)", border: 0, fontWeight: 600 }}
              data-testid="onboard-next"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={() => onCommit(playerName.trim(), saveName.trim(), romId)}
              disabled={!canStep2}
              style={{ flex: 2, padding: 14, borderRadius: "var(--r-md)", background: "var(--accent)", color: "var(--accent-on)", border: 0, fontWeight: 600 }}
              data-testid="onboard-create"
            >
              Create save
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Smoke test**

Clear `player.name` in DevTools → reload `/` → confirm onboarding modal renders. Walk all three steps.

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/OnboardingModal.tsx
git commit -m "feat(home): onboarding modal (3-step name → how-it-works → first save)"
```

### Task 3.5: M3 closing — typecheck, build, screenshot, regression sweep

- [ ] **Step 1: Tests + typecheck + build**

```bash
npm --workspace client run test
npm run typecheck
npm --workspace client run build
```

Expected: all pass.

- [ ] **Step 2: Manual regression sweep on the dev server**

Start `npm run dev` and exercise:
- First-time visit (clear `player.name`) → onboarding modal → all three steps → lands in `/s/<id>`.
- Returning user → home shows carousel of saves; swipe works; play button opens session.
- Long-press a card → action sheet appears with all expected items; rename via Prompt; archive moves the save out (verify in `/settings → Archived`).
- FAB opens NewSaveSheet → create works.
- Avatar tap opens Prompt; name change reflects in topbar.
- Footer SHA link opens GitHub commit.

Take a Playwright MCP screenshot of `/` and confirm visual.

- [ ] **Step 3: Commit any stray follow-ups**

If small CSS bugs surfaced during the sweep, fix them and commit:

```bash
git add -p client/src/ui/home.css
git commit -m "fix(home): <one-line description>"
```

M3 is complete. Home is rewritten; Play and the editor still pending.

---

## Milestone M4 — Play screen rewrite

**Goal at end of M4:** `/s/<saveId>` renders no header; the canvas centers on a gradient background; a peek sheet sits at the bottom showing roster + status + speed; dragging up reveals the expanded sheet with Now-playing, Players, Controls, Audio, and Per-game settings sections. `.conn-banner` is replaced by a transient `<StatusPill>`. Everything that today's header does is reachable in the sheet. All WS / mGBA / snapshot logic stays exactly as it is.

### Task 4.1: New session stylesheet

**Files:**
- Create: `client/src/ui/session.css`
- Modify: `client/src/main.tsx`

- [ ] **Step 1: Create `client/src/ui/session.css`**

```css
.play-shell-v2 {
  position: fixed; inset: 0;
  background: var(--bg-0);
  color: var(--fg);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.play-bg-v2 {
  position: absolute; inset: 0;
  z-index: 0;
  opacity: .55;
  filter: blur(40px) saturate(140%);
}
.play-canvas-wrap-v2 {
  position: relative; z-index: 1;
  flex: 1; min-height: 0;
  display: flex; align-items: center; justify-content: center;
  padding: calc(var(--safe-top) + 8px) calc(var(--safe-right) + 8px)
          80px /* room for peek sheet */ calc(var(--safe-left) + 8px);
}
.play-canvas-v2 {
  display: block;
  max-width: 100%; max-height: 100%;
  width: auto; height: auto;
  image-rendering: pixelated;
  background: #000;
  border-radius: 6px;
  box-shadow: var(--sh-2);
}

/* Peek sheet — content of the sheet body */
.peek-row {
  display: flex; align-items: center; gap: 12px;
  min-height: 44px;
  padding: 0 4px;
}
.peek-row .avs { display: flex; }
.peek-row .avs > * { margin-left: -6px; }
.peek-row .status { flex: 1; min-width: 0; font-size: 13px; }
.peek-row .status .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; background: #4ade80; vertical-align: middle; }
.peek-row .speed {
  background: var(--bg-3); color: var(--fg);
  border: 0; border-radius: 99px;
  padding: 6px 14px;
  font-size: 13px; font-weight: 700;
  cursor: pointer;
}
.peek-row .speed[data-active="true"] { background: var(--accent); color: var(--accent-on); }

/* Expanded sections */
.exp-section { margin-bottom: 18px; }
.exp-section h3 {
  font-size: 11px; color: var(--fg-muted);
  letter-spacing: .06em; text-transform: uppercase;
  margin: 0 0 8px;
}
.exp-row {
  display: flex; align-items: center; gap: 10px;
  min-height: var(--tap-min);
  padding: 10px 12px;
  background: var(--bg-3);
  border-radius: var(--r-md);
  margin-bottom: 6px;
}
.exp-row.tap { cursor: pointer; }
.exp-row .label { flex: 1; }
.exp-row .value { color: var(--fg-muted); font-size: 13px; }
.exp-now-playing .name { font-size: 19px; font-weight: 700; }
.exp-now-playing .sub  { font-size: 12px; color: var(--fg-muted); }
.exp-now-playing .exit {
  margin-left: auto;
  background: var(--bg-3); color: var(--fg);
  border: 0; border-radius: var(--r-md);
  padding: 8px 14px;
  font-size: 13px; cursor: pointer;
}
.exp-promote {
  background: transparent; border: 0; color: var(--accent);
  font-size: 12px; cursor: pointer; padding: 4px 8px;
  align-self: flex-start;
}
```

- [ ] **Step 2: Import in `main.tsx`** (after `home.css`)

```tsx
import "./ui/session.css";
```

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/session.css client/src/main.tsx
git commit -m "feat(session): new stylesheet for chromeless canvas + peek sheet"
```

### Task 4.2: Rewrite `SessionPage.tsx` chrome — keep all WS/mGBA logic untouched

This is the largest single rewrite in the project. The strategy: keep every ref, every WS message handler, every snapshot loop, every effect EXACTLY as it is today. Replace only the JSX that renders `.play-header`, `.play-canvas-wrap`, `<Gamepad/>`, `.conn-banner`, and the needs-tap overlay.

**Files:**
- Modify: `client/src/ui/SessionPage.tsx`
- Modify: `client/src/ui/Gamepad.tsx` (apply `--pad-opacity` and per-button CSS vars; defaults unchanged when vars absent)

- [ ] **Step 1: Open `client/src/ui/SessionPage.tsx` and locate the JSX block beginning with `return (` after `if (status === "error")`. The block today is lines ~587–741.**

The structure is:
```
<div className="play-shell" ...>
  <div className="play-header"> ... </div>
  <div className="play-canvas-wrap"><canvas/></div>
  <Gamepad .../>
  { conn-banner if needed }
  { needs-tap overlay if needed }
</div>
```

Replace the contents of that `return (` block with the new JSX below. Do NOT touch any ref/state/handler above the return.

```tsx
return (
  <div
    className="play-shell-v2"
    data-status={status}
    data-role={role ?? "unknown"}
    data-layout={layout}
  >
    {/* Decorative blurred backdrop */}
    <div
      className="play-bg-v2"
      style={{ background: gradientForName(saveName || romName || "?") }}
      aria-hidden
    />

    <div className="play-canvas-wrap-v2">
      <canvas
        ref={canvasRef}
        width={240}
        height={160}
        className="play-canvas-v2"
      />
    </div>

    <Gamepad
      onPress={(b: GbaButton) => {
        const c = coreRef.current; if (!c) return;
        c.pressButton(b);
        if (roleRef.current === "controller") netRef.current?.send({ type: "input", frame: c.getFrame(), button: b, pressed: true });
      }}
      onRelease={(b: GbaButton) => {
        const c = coreRef.current; if (!c) return;
        c.releaseButton(b);
        if (roleRef.current === "controller") netRef.current?.send({ type: "input", frame: c.getFrame(), button: b, pressed: false });
      }}
      disabled={!isController}
    />

    {/* Status pill for transient events */}
    {connState !== "open" && status === "running" && (
      <StatusPill tone="warn" testId="conn-pill">
        {connState === "connecting" ? "Reconnecting…" : "Connection lost — retrying."}
      </StatusPill>
    )}

    {/* In-game peek/expanded sheet */}
    <InGameSheet
      saveName={saveName}
      romName={romName}
      saveId={saveId}
      role={role}
      connState={connState}
      roster={roster}
      selfId={selfId}
      multiplier={multiplier}
      muted={muted}
      isController={isController}
      layoutPref={layoutPref}
      effectiveLayout={layout}
      contributors={contributors}
      onExit={onBack}
      onCycleSpeed={cycleSpeed}
      onToggleMute={toggleMute}
      onLayoutChange={(v) => setLayoutPref(v === "auto" ? null : v)}
      onHandover={handover}
      onPromoteLayoutDefault={() => {
        // Promote the current session layout choice into per-game settings.
        const romIdForSave = romName ? romName : null; // we use romName as id surrogate; for the real ROM id, see Step 3 below.
      }}
      romId={romId}
    />

    {status === "needs-tap" && (
      <Modal open>
        <div style={{ maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "85dvh" }}>
          <div style={{ fontSize: 11, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>{romName}</div>
          <h1 style={{ fontSize: 28, marginBottom: 8 }}>{saveName}</h1>
          <div style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 18 }}>
            {role === "controller" ? "You're in control" : role === "follower" ? "You're watching" : "Joining…"}
          </div>
          <p style={{ color: "var(--fg-muted)", marginBottom: 18 }}>
            Tap below to start. We need the tap to unlock audio and enter fullscreen.
          </p>
          <button
            onClick={onTapStart}
            data-testid="tap-to-start"
            style={{
              background: "var(--accent)", color: "var(--accent-on)",
              border: 0, borderRadius: "var(--r-md)", padding: 16,
              fontSize: 17, fontWeight: 700, cursor: "pointer",
            }}
          >
            Start
          </button>
        </div>
      </Modal>
    )}
  </div>
);
```

- [ ] **Step 2: Add the new imports at the top of `SessionPage.tsx`**

```tsx
import { gradientForName } from "../lib/gradient";
import { Modal, StatusPill } from "./primitives";
import { InGameSheet } from "./InGameSheet";
```

Track the ROM id (separate from the human-readable name). In the existing `case "welcome":` handler, after `setControllerId(msg.controllerId);`, add:

```tsx
setRomId(msg.romId);
```

And add `const [romId, setRomId] = useState<string>("");` near the other useState hooks.

- [ ] **Step 3: Remove old imports / types that are no longer used**

`IconBack`, `IconMuted`, `IconUnmuted`, `SettingsMenu`, and the `Avatar` import (only if no longer used here) can be removed if the new sheet handles them. Keep them imported if any error/loading path still references them. Run `npm run typecheck` to verify.

- [ ] **Step 4: Commit the cut-over**

```bash
git add client/src/ui/SessionPage.tsx
git commit -m "feat(session): chromeless canvas + status pill (chrome rewrite WIP — InGameSheet next)"
```

This will not compile yet because `InGameSheet` doesn't exist. That lands in Task 4.3.

### Task 4.3: Create `InGameSheet.tsx`

**Files:**
- Create: `client/src/ui/InGameSheet.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useState } from "react";
import { Sheet, type SheetState, SegmentedControl, ActionSheet, type ActionItem } from "./primitives";
import { Avatar } from "./Avatar";
import { SPEED_LADDER, type RosterEntry, type Role } from "@gba/shared";
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
  contributors: Record<string, number>;
  onExit: () => void;
  onCycleSpeed: () => void;
  onToggleMute: () => void;
  onLayoutChange: (v: ControlLayout | "auto") => void;
  onHandover: (toConnId: string) => void;
  romIdForSettings?: string; // optional; used to persist promoted layout
  romId: string;
}

export function InGameSheet(props: Props) {
  const {
    saveName, romName, romId, role, connState, roster, selfId,
    multiplier, muted, isController, layoutPref, effectiveLayout,
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
        {state === "peek" || state === "expanded" ? (
          <PeekRow
            roster={roster}
            statusText={statusText}
            multiplier={multiplier}
            isController={isController}
            onCycleSpeed={onCycleSpeed}
            onExpand={() => setState("expanded")}
          />
        ) : null}

        {state === "expanded" && (
          <div style={{ marginTop: 8 }}>
            {/* Now playing */}
            <div className="exp-section exp-now-playing">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div className="name">{saveName}</div>
                  <div className="sub">{romName} · #{props.saveId} · {role ?? "joining"} · {connState}</div>
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
                  <SegmentedControl<string>
                    options={SPEED_LADDER.map((n) => ({ value: String(n), label: `${n}×` }))}
                    value={String(multiplier)}
                    onChange={(v) => {
                      // Cycle until we reach v — uses existing cycleSpeed which
                      // walks the ladder. Tap as many times as needed.
                      const target = parseInt(v, 10);
                      while (parseInt(String(multiplier), 10) !== target) {
                        onCycleSpeed();
                        // Break after one cycle; the parent's state will update
                        // on next render so this is effectively single-step.
                        break;
                      }
                    }}
                    testId="ingame-speed"
                  />
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

            {/* Per-game settings shortcut */}
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
```

The duplicated `romId` field in the `Props` interface is intentional (above the import: declared once). Remove the older `romIdForSettings?: string` declaration line; only `romId: string;` should remain.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Fix any reported errors inline. Common issues:
- `RosterEntry` may have a slightly different shape — open `shared/src/index.ts` to confirm field names.
- If `Role` isn't exported from `@gba/shared`, change the import accordingly.

- [ ] **Step 3: Smoke test**

`npm run dev`, open a save, confirm:
- No header.
- Peek sheet visible at bottom with roster + status + speed pill.
- Tap peek → sheet expands to show Now playing / Players / Controls / Audio / Settings for this game.
- Exit button returns to home.
- Layout segmented control changes layout live; "Save as default for this game" persists it (verify in DevTools localStorage).
- Connection-lost pill shows when WS is closed.
- The Start modal looks clean (re-styled).

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/InGameSheet.tsx client/src/ui/SessionPage.tsx
git commit -m "feat(session): InGameSheet — peek + expanded with all chrome migrated"
```

### Task 4.4: Wire `Gamepad.tsx` to consume per-button CSS vars (foundation for M5)

**Files:**
- Modify: `client/src/ui/Gamepad.tsx`

- [ ] **Step 1: Wrap the pad panels in a single container that reads CSS vars**

In `Gamepad.tsx`'s return block, wrap both `pad-panel` divs in a single `<div className="pad-host" style={{ "--pad-opacity": padOpacity ?? 1, ... } as CSSProperties}>` IF a `buttonLayout` prop is supplied.

For now (M4 closing), accept an optional `buttonLayout` prop with type `OrientationLayout | null` and apply nothing if null. The actual editor populates it in M5.

```tsx
import { useEffect, useRef, type CSSProperties } from "react";
import type { GbaButton } from "@gba/shared";
import type { OrientationLayout } from "../lib/settings";

interface Props {
  onPress: (b: GbaButton) => void;
  onRelease: (b: GbaButton) => void;
  disabled?: boolean;
  buttonLayout?: OrientationLayout | null;
}

// ... existing attachButton, attachDpad, KEY_MAP unchanged ...

export function Gamepad({ onPress, onRelease, disabled, buttonLayout }: Props) {
  // ... existing refs and effects unchanged ...

  const cssVars: CSSProperties = buttonLayout
    ? Object.assign(
        { ["--pad-opacity"]: buttonLayout.opacity } as any,
        ...Object.entries(buttonLayout.buttons).map(([id, p]) => ({
          [`--btn-${id}-x`]: `${p.x}%`,
          [`--btn-${id}-y`]: `${p.y}%`,
          [`--btn-${id}-size`]: p.size,
        })),
      )
    : {};

  const disabledCls = disabled ? " pad-disabled" : "";

  return (
    <div className="pad-host" style={cssVars} data-custom={buttonLayout ? "true" : undefined}>
      <div className={`pad-panel pad-panel-left${disabledCls}`} aria-hidden={disabled}>
        {/* ... existing left-panel JSX ... */}
      </div>
      <div className={`pad-panel pad-panel-right${disabledCls}`} aria-hidden={disabled}>
        {/* ... existing right-panel JSX ... */}
      </div>
    </div>
  );
}
```

Append to `client/src/ui/styles.css`:

```css
.pad-host { display: contents; }
.pad-host[data-custom="true"] {
  /* When a custom layout is applied, child pad-panels use absolute positioning
     against the viewport and read the vars below. Falls back to today's
     [data-layout="..."] rules when no custom layout is set. */
}
.pad-host[data-custom="true"] .pad-panel { display: none; }
.pad-host[data-custom="true"]::after,
.pad-host[data-custom="true"] > * {
  opacity: var(--pad-opacity, 1);
}
```

(The full CSS hookup for absolute button positioning per ID lands in M5 Task 5.4. M4's job is to ensure the prop plumbing is in place without breaking today's default rendering.)

- [ ] **Step 2: Pass the layout from SessionPage**

In `SessionPage.tsx`, near the existing `useResolvedSettings` (added in M2): import it and the orientation hook, and pass the matching orientation layout to `<Gamepad>`:

```tsx
import { useResolvedSettings, useOrientation } from "../lib/settings";

// Inside the component:
const isLandscape = useOrientation();
const resolved = useResolvedSettings(romId || null);
const orientationLayout = resolved.buttonLayout
  ? (isLandscape ? resolved.buttonLayout.orientations.landscape : resolved.buttonLayout.orientations.portrait)
  : null;

// In the JSX:
<Gamepad
  onPress={...}
  onRelease={...}
  disabled={!isController}
  buttonLayout={orientationLayout}
/>
```

- [ ] **Step 3: Smoke test**

Confirm normal play with no custom layout still renders today's flanking/overlay/stacked layouts. Manually inject a `settings.rom.<id>` entry in localStorage with a sample `buttonLayout` value to confirm `data-custom="true"` appears on `.pad-host` (no positioning yet — that's M5).

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/Gamepad.tsx client/src/ui/styles.css client/src/ui/SessionPage.tsx
git commit -m "feat(gamepad): consume optional buttonLayout via CSS vars (no-op without override)"
```

### Task 4.5: M4 closing — tests + typecheck + smoke

- [ ] **Step 1: Tests + typecheck + build**

```bash
npm --workspace client run test
npm run typecheck
npm --workspace client run build
```

Expected: all pass.

- [ ] **Step 2: Two-person smoke test (the hard one)**

Open the same save in two browsers (a desktop + a phone), verify:
- Both see the new chromeless canvas + peek sheet.
- Controller can hand over via Players → Hand over → Confirm.
- Speed changes broadcast.
- Mute toggle works.
- Connection-lost StatusPill appears when WS is dropped (toggle airplane mode on the phone).

- [ ] **Step 3: Visual screenshot**

Playwright MCP screenshot of `/s/<id>` in landscape — confirm the canvas centers and the peek sheet is visible.

M4 is complete. Home and Session both render the new design. Settings exists. The button editor scaffolding (custom layout consumption via CSS vars) is in place but no editor UI yet — that's M5.

---

## Milestone M5 — Button-layout editor

**Goal at end of M5:** `/edit-controls?scope=global|rom:<id>` renders an editor with a 240×160-aspect placeholder, the on-screen pad rendered in the current resolved layout, drag-to-position + corner-resize handles, alignment guides, grid-snap toggle, opacity slider, orientation switcher. Save persists to `settings.global.buttonLayout` or `settings.rom.<id>.buttonLayout`. Gamepad's custom-layout CSS rules apply per-button positioning when a layout is set.

### Task 5.1: ButtonLayout types & built-in defaults

**Files:**
- Create: `client/src/lib/buttonLayout.ts`
- Create: `client/src/lib/buttonLayout.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_PORTRAIT, DEFAULT_LANDSCAPE, DEFAULT_BUTTON_LAYOUT, clampToSafeArea } from "./buttonLayout";

describe("DEFAULT_BUTTON_LAYOUT", () => {
  it("contains all 7 GBA buttons in both orientations", () => {
    const ids = ["dpad", "a", "b", "l", "r", "start", "select"];
    for (const id of ids) {
      expect(DEFAULT_PORTRAIT.buttons[id as keyof typeof DEFAULT_PORTRAIT.buttons]).toBeDefined();
      expect(DEFAULT_LANDSCAPE.buttons[id as keyof typeof DEFAULT_LANDSCAPE.buttons]).toBeDefined();
    }
  });
  it("opacity is between 0.3 and 1.0", () => {
    expect(DEFAULT_PORTRAIT.opacity).toBeGreaterThanOrEqual(0.3);
    expect(DEFAULT_LANDSCAPE.opacity).toBeLessThanOrEqual(1.0);
  });
  it("schemaVersion is 1", () => {
    expect(DEFAULT_BUTTON_LAYOUT.schemaVersion).toBe(1);
  });
});

describe("clampToSafeArea", () => {
  it("clamps x and y inside [0,100]", () => {
    const clamped = clampToSafeArea({ x: 105, y: -5, size: 1 }, { top: 0, bottom: 0, left: 0, right: 0 });
    expect(clamped.x).toBeLessThanOrEqual(100);
    expect(clamped.y).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
npm --workspace client run test -- buttonLayout
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { ButtonId, OrientationLayout, ButtonLayout } from "./settings";

export const DEFAULT_PORTRAIT: OrientationLayout = {
  opacity: 0.85,
  buttons: {
    dpad:   { x: 20, y: 75, size: 1.0 },
    a:      { x: 85, y: 70, size: 1.0 },
    b:      { x: 72, y: 78, size: 1.0 },
    l:      { x: 10, y: 60, size: 0.8 },
    r:      { x: 90, y: 60, size: 0.8 },
    start:  { x: 60, y: 92, size: 0.7 },
    select: { x: 40, y: 92, size: 0.7 },
  },
};

export const DEFAULT_LANDSCAPE: OrientationLayout = {
  opacity: 0.85,
  buttons: {
    dpad:   { x: 10, y: 60, size: 1.0 },
    a:      { x: 92, y: 55, size: 1.0 },
    b:      { x: 82, y: 65, size: 1.0 },
    l:      { x: 6,  y: 18, size: 0.8 },
    r:      { x: 94, y: 18, size: 0.8 },
    start:  { x: 60, y: 92, size: 0.7 },
    select: { x: 40, y: 92, size: 0.7 },
  },
};

export const DEFAULT_BUTTON_LAYOUT: ButtonLayout = {
  schemaVersion: 1,
  orientations: {
    portrait: DEFAULT_PORTRAIT,
    landscape: DEFAULT_LANDSCAPE,
  },
};

export interface SafeArea { top: number; bottom: number; left: number; right: number; }

export function clampToSafeArea(
  pos: { x: number; y: number; size: number },
  safe: SafeArea,
): { x: number; y: number; size: number } {
  // x/y are percentages of viewport short-axis. Safe area insets are px,
  // so we convert to approximate % using a 400px short-axis baseline.
  const approxShort = 400;
  const leftPct  = (safe.left  / approxShort) * 100;
  const rightPct = 100 - (safe.right  / approxShort) * 100;
  const topPct   = (safe.top   / approxShort) * 100;
  const botPct   = 100 - (safe.bottom / approxShort) * 100;
  return {
    x: Math.max(leftPct, Math.min(rightPct, pos.x)),
    y: Math.max(topPct,  Math.min(botPct,   pos.y)),
    size: Math.max(0.5, Math.min(2.0, pos.size)),
  };
}

export function deepClone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o));
}

export type { ButtonId, ButtonLayout, OrientationLayout };
```

- [ ] **Step 4: Confirm pass**

```bash
npm --workspace client run test -- buttonLayout
```

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/buttonLayout.ts client/src/lib/buttonLayout.test.ts
git commit -m "feat(layout): ButtonLayout types, defaults, safe-area clamp helper"
```

### Task 5.2: CSS positioning for custom layouts

**Files:**
- Modify: `client/src/ui/styles.css`

- [ ] **Step 1: Append absolute-positioning rules**

```css
/* Custom button layout. Only active when .pad-host has data-custom="true".
   Each button anchors at (var(--btn-<id>-x), var(--btn-<id>-y)) and scales
   by var(--btn-<id>-size). x/y are % of the short-axis viewport. */

.pad-host[data-custom="true"] .pad-panel { display: none; }

.pad-host[data-custom="true"] .pad-btn-custom,
.pad-host[data-custom="true"] .pad-dpad-custom {
  position: fixed;
  z-index: 30;
  opacity: var(--pad-opacity, 1);
  transform: translate(-50%, -50%);
}

.pad-host[data-custom="true"] .pad-dpad-custom { left: var(--btn-dpad-x); top: var(--btn-dpad-y); width: calc(96px * var(--btn-dpad-size, 1)); height: calc(96px * var(--btn-dpad-size, 1)); }
.pad-host[data-custom="true"] .pad-a-custom    { left: var(--btn-a-x);    top: var(--btn-a-y);    width: calc(56px * var(--btn-a-size, 1));    height: calc(56px * var(--btn-a-size, 1)); }
.pad-host[data-custom="true"] .pad-b-custom    { left: var(--btn-b-x);    top: var(--btn-b-y);    width: calc(56px * var(--btn-b-size, 1));    height: calc(56px * var(--btn-b-size, 1)); }
.pad-host[data-custom="true"] .pad-l-custom    { left: var(--btn-l-x);    top: var(--btn-l-y);    width: calc(48px * var(--btn-l-size, 1));    height: calc(28px * var(--btn-l-size, 1)); }
.pad-host[data-custom="true"] .pad-r-custom    { left: var(--btn-r-x);    top: var(--btn-r-y);    width: calc(48px * var(--btn-r-size, 1));    height: calc(28px * var(--btn-r-size, 1)); }
.pad-host[data-custom="true"] .pad-start-custom  { left: var(--btn-start-x);  top: var(--btn-start-y);  width: calc(56px * var(--btn-start-size, .7));  height: calc(22px * var(--btn-start-size, .7)); }
.pad-host[data-custom="true"] .pad-select-custom { left: var(--btn-select-x); top: var(--btn-select-y); width: calc(56px * var(--btn-select-size, .7)); height: calc(22px * var(--btn-select-size, .7)); }
```

- [ ] **Step 2: Add the custom-layout JSX path in `Gamepad.tsx`**

In `Gamepad.tsx`, when `buttonLayout` is set, render an alternate JSX block. Replace the `return (` block:

```tsx
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
        <button ref={lRef} className="pad-btn pad-shoulder pad-l-custom">L</button>
        <button ref={rRef} className="pad-btn pad-shoulder pad-r-custom">R</button>
        <div ref={dpadRef} className="pad-dpad pad-dpad-custom" aria-label="D-pad">
          <div className="dpad-up">▲</div>
          <div className="dpad-left">◀</div>
          <div className="dpad-right">▶</div>
          <div className="dpad-down">▼</div>
          <div className="dpad-center" />
        </div>
        <button ref={bRef} className="pad-btn pad-face-b pad-b-custom">B</button>
        <button ref={aRef} className="pad-btn pad-face-a pad-a-custom">A</button>
        <button ref={startRef} className="pad-btn pad-pill pad-start-custom">START</button>
        <button ref={selectRef} className="pad-btn pad-pill pad-select-custom">SELECT</button>
      </>
    )}
  </div>
);
```

- [ ] **Step 3: Smoke test**

In DevTools localStorage, set `settings.rom.test-arm.gba` to:
```json
{"buttonLayout":{"schemaVersion":1,"orientations":{"portrait":{"opacity":0.9,"buttons":{"dpad":{"x":20,"y":70,"size":1},"a":{"x":85,"y":65,"size":1},"b":{"x":72,"y":75,"size":1},"l":{"x":10,"y":60,"size":0.8},"r":{"x":90,"y":60,"size":0.8},"start":{"x":60,"y":92,"size":0.7},"select":{"x":40,"y":92,"size":0.7}},"opacity":0.9},"landscape":{"opacity":0.9,"buttons":{"dpad":{"x":15,"y":50,"size":1},"a":{"x":90,"y":50,"size":1},"b":{"x":80,"y":60,"size":1},"l":{"x":6,"y":18,"size":0.8},"r":{"x":94,"y":18,"size":0.8},"start":{"x":60,"y":92,"size":0.7},"select":{"x":40,"y":92,"size":0.7}}}}}}
```

Open the test save → confirm buttons render at the custom positions and still press correctly.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/styles.css client/src/ui/Gamepad.tsx
git commit -m "feat(gamepad): absolute positioning for custom layouts via CSS vars"
```

### Task 5.3: ButtonEditor route scaffold + non-interactive preview

**Files:**
- Create: `client/src/ui/ButtonEditor.tsx`
- Create: `client/src/ui/editor.css`
- Modify: `client/src/App.tsx`
- Modify: `client/src/main.tsx`

- [ ] **Step 1: Create `client/src/ui/editor.css`**

```css
.editor-shell {
  position: fixed; inset: 0;
  background: var(--bg-0); color: var(--fg);
  display: flex; flex-direction: column;
  z-index: 50;
}
.editor-topbar {
  display: flex; align-items: center; gap: 12px;
  padding: calc(var(--safe-top) + 8px) 16px 8px;
  background: var(--bg-1);
}
.editor-topbar .scope-label { font-weight: 700; flex: 1; min-width: 0; }
.editor-topbar .seg-wrap { flex-shrink: 0; }

.editor-canvas {
  flex: 1; position: relative;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-0);
  overflow: hidden;
}
.editor-screen {
  background: #fff; border: 2px solid var(--bg-3);
  box-shadow: var(--sh-2);
  border-radius: 4px;
}

/* Editor handles overlay each button */
.btn-handle {
  position: absolute;
  pointer-events: auto;
}
.btn-handle .move {
  position: absolute; inset: 0;
  border: 2px dashed var(--accent);
  border-radius: 50%;
  cursor: grab;
}
.btn-handle .resize {
  position: absolute; right: -8px; bottom: -8px;
  width: 20px; height: 20px;
  background: var(--accent); color: var(--accent-on);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: nwse-resize;
  font-size: 12px;
}
.btn-handle[data-selected="true"] .move { border-style: solid; }

.editor-guides .guide {
  position: absolute;
  background: var(--accent);
  opacity: .7;
  pointer-events: none;
}
.editor-guides .guide.vert { width: 1px; top: 0; bottom: 0; }
.editor-guides .guide.horiz { height: 1px; left: 0; right: 0; }

.editor-bottombar {
  background: var(--bg-1);
  padding: 12px 16px calc(var(--safe-bottom) + 12px);
  display: flex; flex-direction: column; gap: 10px;
}
.editor-bottombar .row { display: flex; gap: 12px; align-items: center; }
.editor-bottombar .actions { display: flex; gap: 10px; }
.editor-bottombar .actions button {
  flex: 1; min-height: var(--tap-min);
  background: var(--bg-3); color: var(--fg);
  border: 0; border-radius: var(--r-md);
  font-size: 15px; font-weight: 600;
  cursor: pointer;
}
.editor-bottombar .actions button.primary { background: var(--accent); color: var(--accent-on); }
.editor-bottombar .actions button.danger { color: var(--danger); }
```

- [ ] **Step 2: Import `editor.css` in `main.tsx`**

```tsx
import "./ui/editor.css";
```

- [ ] **Step 3: Create `client/src/ui/ButtonEditor.tsx` (initial non-interactive scaffold)**

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { navigate, useRoute } from "../lib/router";
import {
  loadGlobal, saveGlobal, loadRom, saveRom,
  useOrientation,
  type ButtonLayout, type OrientationLayout, type ButtonId,
} from "../lib/settings";
import {
  DEFAULT_BUTTON_LAYOUT, DEFAULT_PORTRAIT, DEFAULT_LANDSCAPE,
  clampToSafeArea, deepClone,
} from "../lib/buttonLayout";
import { listRoms, type RomMeta } from "../lib/api";
import { SegmentedControl, Slider } from "./primitives";
import { useSafeArea } from "./hooks/useSafeArea";

type Scope = { kind: "global" } | { kind: "rom"; romId: string };

function readScope(search: URLSearchParams): Scope {
  const raw = search.get("scope") ?? "global";
  if (raw.startsWith("rom:")) return { kind: "rom", romId: decodeURIComponent(raw.slice(4)) };
  return { kind: "global" };
}

export function ButtonEditor() {
  const route = useRoute();
  const scope = readScope(route.search);

  const isLandscape = useOrientation();
  const [orientation, setOrientation] = useState<"portrait" | "landscape">(
    isLandscape ? "landscape" : "portrait",
  );

  const [layout, setLayout] = useState<ButtonLayout>(() => loadScopeLayout(scope));
  const [selected, setSelected] = useState<ButtonId | null>(null);
  const [gridSnap, setGridSnap] = useState(false);
  const [roms, setRoms] = useState<RomMeta[]>([]);

  useEffect(() => { listRoms().then(setRoms).catch(() => {}); }, []);
  const romName = scope.kind === "rom" ? (roms.find((r) => r.id === scope.romId)?.name ?? scope.romId) : "Default layout";

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
  };

  const onSave = () => {
    if (scope.kind === "global") {
      const g = loadGlobal();
      saveGlobal({ ...g, buttonLayout: layout });
    } else {
      const r = loadRom(scope.romId);
      saveRom(scope.romId, { ...r, buttonLayout: layout });
    }
    navigate(-1 as unknown as string); // best-effort back; replaced by history.back() below.
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

function loadScopeLayout(scope: Scope): ButtonLayout {
  if (scope.kind === "global") {
    const g = loadGlobal();
    return g.buttonLayout ? deepClone(g.buttonLayout) : deepClone(DEFAULT_BUTTON_LAYOUT);
  }
  const r = loadRom(scope.romId);
  if (r.buttonLayout) return deepClone(r.buttonLayout);
  // Fall back to whatever global is (so user starts from "what they see").
  const g = loadGlobal();
  return g.buttonLayout ? deepClone(g.buttonLayout) : deepClone(DEFAULT_BUTTON_LAYOUT);
}

// EditorCanvas is defined in the next task.
function EditorCanvas(_: any) { return null; }
```

- [ ] **Step 4: Wire route in `App.tsx`**

```tsx
import { ButtonEditor } from "./ui/ButtonEditor";

// inside App():
if (route.path === "/edit-controls") return <ButtonEditor />;
```

- [ ] **Step 5: Commit (won't fully function yet — EditorCanvas next)**

```bash
git add client/src/ui/ButtonEditor.tsx client/src/ui/editor.css client/src/App.tsx client/src/main.tsx
git commit -m "feat(editor): /edit-controls scaffold — scope parsing, top/bottom bars, save wiring"
```

### Task 5.4: EditorCanvas — drag, resize, alignment guides

**Files:**
- Modify: `client/src/ui/ButtonEditor.tsx` (replace the placeholder `EditorCanvas` with a real one)

- [ ] **Step 1: Implement `EditorCanvas`**

Replace the placeholder `function EditorCanvas(_: any) { return null; }` with:

```tsx
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

  // Determine the GBA screen rectangle size to render.
  const screenStyle = useMemo(() => {
    // 240:160 = 3:2 aspect. Fit into 70% of the canvas in either orientation.
    return orientation === "landscape"
      ? { width: "min(48vw, 60vh * 1.5)", aspectRatio: "240/160" }
      : { width: "min(72vw, 50vh * 1.5)", aspectRatio: "240/160" };
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
    (e.target as Element).setPointerCapture?.(e.pointerId);
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
```

- [ ] **Step 2: Smoke test**

Visit `/edit-controls?scope=global`. Confirm:
- Top bar shows "Default layout" + Portrait/Landscape segmented control.
- White GBA-screen placeholder centered in the canvas.
- All 7 button handles visible at default positions.
- Drag a handle: it moves smoothly; alignment guides flash when crossing other buttons' x/y.
- Drag the resize corner: the button grows/shrinks.
- Grid snap toggle: drags snap to 4% increments.
- Opacity slider: dims the whole layout.
- Reset orientation: returns just the current orientation to default.
- Save: writes to `localStorage["settings.global"].buttonLayout` and pops back.
- Cancel: pops back without saving.

- [ ] **Step 3: Visit `/edit-controls?scope=rom:test-arm.gba`**

Confirm scope label shows ROM name; save writes to `settings.rom.test-arm.gba`.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/ButtonEditor.tsx
git commit -m "feat(editor): interactive drag/resize with alignment guides + grid snap"
```

### Task 5.5: Wire "Customize default button layout…" row in Settings

**Files:**
- (No code change — already wired in Task 2.3 to navigate to `/edit-controls?scope=global`)
- Modify: `client/src/ui/SettingsPage.tsx` (update the row's value text after save)

- [ ] **Step 1: Re-read global on focus**

In `SettingsPage.tsx`, replace the static `settings.buttonLayout ? "Customized" : "Default"` with a value that updates when the user returns from the editor. Add a `popstate` listener:

```tsx
useEffect(() => {
  const onPop = () => {
    // Re-read global; useGlobalSettings already does this, but force a state refresh.
    setS(loadGlobal());
  };
  window.addEventListener("popstate", onPop);
  return () => window.removeEventListener("popstate", onPop);
}, []);
```

Where `setS` is the setter exposed by `useGlobalSettings`. If the setter isn't exposed, refactor `useGlobalSettings` to expose `refresh`:

```ts
export function useGlobalSettings() {
  const [settings, setS] = useState<GlobalSettings>(loadGlobal);
  return {
    settings,
    setSettings: (n: GlobalSettings) => { saveGlobal(n); setS(n); },
    patch: (d: Partial<GlobalSettings>) => { const n = { ...settings, ...d }; saveGlobal(n); setS(n); },
    refresh: () => setS(loadGlobal()),
  };
}
```

And call `refresh()` from the `popstate` listener.

- [ ] **Step 2: Commit**

```bash
git add client/src/ui/SettingsPage.tsx client/src/lib/settings.ts
git commit -m "feat(settings): refresh global settings on return from editor"
```

### Task 5.6: M5 closing — tests + typecheck + screenshot

- [ ] **Step 1: Tests + typecheck + build**

```bash
npm --workspace client run test
npm run typecheck
npm --workspace client run build
```

Expected: all pass.

- [ ] **Step 2: Full flow smoke test**

1. Visit `/settings`, tap "Default button layout" → editor opens. Move A button. Save. Confirm the row text changes from "Default" to "Customized."
2. Tap "Per-game customizations" → "+ Customize another game" → pick a ROM → editor opens. Move D-pad. Save.
3. Return to `/settings/per-game` → ROM appears in the list. Tap it → action sheet → "Reset to defaults" removes it.
4. From in-game `/s/<id>` expanded sheet → "Customize buttons for this game" → editor opens with scope=rom:<id>. Save and confirm the custom layout applies when you return to the session.

- [ ] **Step 3: Playwright MCP screenshot**

Take screenshots of the editor in both orientations and the resulting custom layout in-game.

M5 is complete. The full redesign is functionally in place.

---

## Milestone M6 — Polish

**Goal at end of M6:** Haptics fire on every meaningful interaction, sound feedback toggles a subtle tap click, all transitions feel snappy on phones, and a documented cross-device smoke pass is logged.

### Task 6.1: Wire haptics across interactive primitives

**Files:**
- Modify: `client/src/ui/primitives/Sheet.tsx` (snap-to-state haptic)
- Modify: `client/src/ui/primitives/Slider.tsx` (no haptic per drag — too noisy; only on snap)
- Modify: `client/src/ui/ButtonEditor.tsx` (haptic on pickup + alignment guide cross + grid snap)
- Modify: `client/src/ui/Gamepad.tsx` (already uses vibrate(8); replace with useHaptics)

- [ ] **Step 1: Sheet snap haptic**

In `Sheet.tsx`'s `onPointerUp`, after determining `next`, call `useHaptics()("snap")` if `next !== state`. Add `import { useHaptics } from "../hooks/useHaptics";` and a `const haptics = useHaptics();` inside the component.

- [ ] **Step 2: Editor handles fire `tap` on pickup, `snap` on alignment-guide hit**

In `EditorCanvas`'s `startDrag`, call `haptics("tap")` at the start. In `move`, when a new guide appears (transition empty → non-empty), call `haptics("snap")`.

- [ ] **Step 3: Gamepad uses `useHaptics` instead of `navigator.vibrate(8)`**

In `Gamepad.tsx`'s `attachButton`, replace:
```ts
if ((navigator as any).vibrate) (navigator as any).vibrate(8);
```
with reading the haptics mode via `useHaptics`. Because `attachButton` runs outside the React tree, pull the haptics function into a ref in the effect and call `hapticsRef.current("tap")` from the press handler.

- [ ] **Step 4: Smoke test**

Set haptics to "strong" in Settings → tap any pad button → confirm strong vibrate. Set to "off" → confirm no vibrate. Open editor → confirm pickup + alignment haptics.

- [ ] **Step 5: Commit**

```bash
git add client/src/ui/primitives/Sheet.tsx client/src/ui/ButtonEditor.tsx client/src/ui/Gamepad.tsx
git commit -m "feat(haptics): wire useHaptics into Sheet snaps, editor drag, gamepad presses"
```

### Task 6.2: Sound feedback (tap click)

**Files:**
- Create: `client/src/lib/click.ts`
- Modify: `client/src/ui/primitives/FAB.tsx`
- Modify: `client/src/ui/primitives/ActionSheet.tsx`
- Modify: `client/src/ui/primitives/SegmentedControl.tsx`

- [ ] **Step 1: Create the click helper**

`client/src/lib/click.ts`:

```ts
import { loadGlobal } from "./settings";

let ctx: AudioContext | null = null;

export function click(): void {
  try {
    if (!loadGlobal().soundFeedback) return;
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.04);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  } catch { /* ignore */ }
}
```

- [ ] **Step 2: Call `click()` from FAB / ActionSheet items / SegmentedControl**

Inside the relevant `onClick` paths, invoke `click()` before the handler.

- [ ] **Step 3: Smoke test**

Toggle "Sound feedback on tap" in Settings → confirm clicks are audible on FAB/segment/action-sheet taps when on, silent when off.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/click.ts client/src/ui/primitives/FAB.tsx client/src/ui/primitives/ActionSheet.tsx client/src/ui/primitives/SegmentedControl.tsx
git commit -m "feat(audio): subtle tap click respecting soundFeedback setting"
```

### Task 6.3: Transition tuning + safe-area sweep

- [ ] **Step 1: Open the dev server in iPhone 14 Pro and Pixel 7 DevTools profiles**

Walk through Home → carousel → long-press → action sheet → play → expand peek → editor. Confirm:
- No content hidden behind the notch / dynamic island / home indicator.
- Sheets bottom-pad to safe-area.
- FAB position respects safe-area inset.

Fix any clipping by adding `padding-{top|bottom}: calc(... + var(--safe-{top|bottom}));` to the offending element.

- [ ] **Step 2: Measure and tune motion**

If sheet animations feel sluggish (>320ms), drop `--dur-sheet` to `280ms`. If the StatusPill flickers, raise its in-duration to `300ms`. Update `tokens.css` accordingly.

- [ ] **Step 3: Commit any tweaks**

```bash
git add client/src/ui/tokens.css client/src/ui/{home,session,settings,editor}.css
git commit -m "chore(ui): safe-area sweep + motion tuning across surfaces"
```

### Task 6.4: Cross-device smoke pass

- [ ] **Step 1: Test matrix**

Run through every surface on:
1. Android Chrome (real phone if available; otherwise DevTools Pixel 7 profile).
2. iOS Safari (DevTools iPhone 14 Pro profile, plus a real iPhone if accessible).
3. Desktop Chrome.

For each: launch onboarding → create save → play with controller → switch device, follow as second player → handover → speed change → edit buttons → exit. Note any visual or behavior bugs.

- [ ] **Step 2: Document the result**

Update `README.md`'s "Troubleshooting" table if any cross-device issue is intentional (e.g., a known iOS quirk).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: refresh troubleshooting table for the redesign"
```

### Task 6.5: Drop the `/primitives` showcase route (or keep it)

The showcase route was a M1 debugging aid. Now that everything is wired into real surfaces, you can drop it or keep it as an internal QA tool. Default: **keep it**, only accessible via direct URL — it's small, costs nothing, and is invaluable when someone wants to verify a primitive in isolation.

If keeping: no action. If dropping: delete `client/src/ui/PrimitivesShowcase.tsx` and the route in `App.tsx`. Commit either way.

### Task 6.6: M6 closing — final verification

- [ ] **Step 1: Run all tests, typecheck, build**

```bash
npm --workspace client run test
npm run typecheck
npm run build
```

Expected: all pass.

- [ ] **Step 2: Final Playwright MCP screenshots for the PR description**

Capture: Home (with saves) · Home (onboarding step 1) · Settings · Per-game settings · Session (peek sheet) · Session (expanded sheet) · Button editor (portrait) · Button editor (landscape).

- [ ] **Step 3: Open PR**

Use commit-commands:commit-push-pr to push and open a PR titled `Native-app feel redesign` with a description summarizing the milestones, linking to the spec at `docs/superpowers/specs/2026-05-27-native-app-feel-design.md`.

The redesign is complete.

---

## Spec coverage map (self-review)

For the self-review step: each spec section maps to tasks.

| Spec section | Plan tasks |
| --- | --- |
| §1 North star | (covered implicitly across all milestones) |
| §2 IA — primary surfaces | Task 2.3 (`/settings`), Task 3.3 (`/`), Task 4.2 (`/s/<id>`), Task 5.3 (`/edit-controls`) |
| §2 IA — sheets/overlays | Task 1.6 (`Sheet`), 1.7 (`ActionSheet`), 1.9 (`Prompt`), 3.3 (NewSaveSheet, action sheet), 4.3 (InGameSheet) |
| §2 "What goes away" | Task 3.3 (home rewrite removes inline form, how-it-works, footer treatment), Task 4.2 (drops `.play-header`) |
| §2 "Kept on Home" | Task 3.3 (Install button + footer kept) |
| §3 Tokens | Task 1.2 |
| §3 Primitives | Tasks 1.6–1.15 |
| §3 Hooks | Tasks 1.3 (`useLongPress`), 1.4 (`useSafeArea`), 1.5 (`useHaptics`); `useSheet` is folded into `Sheet.tsx` itself |
| §3 File layout | Task 3.2, 4.1, 5.3 add the css splits (home.css, session.css, editor.css, settings.css) |
| §4 Home default state | Task 3.3 |
| §4 Onboarding | Task 3.4 |
| §4 Empty state | Task 3.3 (renders empty-state card) |
| §4 Long-press action sheet | Task 3.3 |
| §4 New-save sheet | Task 3.3 |
| §4 Archived → moved to Settings | Task 2.5 |
| §5 Default running view | Task 4.2 |
| §5 Peek sheet | Task 4.3 |
| §5 Expanded sheet sections | Task 4.3 |
| §5 Status pill | Task 4.2 (conn pill); Task 1.14 (component) |
| §5 Needs-tap overlay | Task 4.2 (restyled Modal) |
| §6 Tier 1 Settings page | Tasks 2.3, 2.5 |
| §6 Tier 2 Per-game settings | Tasks 2.4, 3.3 (entry from home), 4.3 (entry from in-game), 5.4 (editor scope=rom) |
| §6 Tier 3 Session-only | Task 4.3 (segmented controls are session-only by default; "Save as default" promotes) |
| §6 Resolution order | Task 2.1 (`resolveSettings`) |
| §6 Storage layout | Task 2.1 |
| §6 Sweep behavior | Task 2.4 (clear on Reset) — saves deleted are unrelated by design |
| §7 Editor entry points | Tasks 2.3, 2.4, 4.3 all link to `/edit-controls` |
| §7 Editor screen | Tasks 5.3, 5.4 |
| §7 Layout data model | Task 2.1 (types), 5.1 (defaults + clamp) |
| §7 Visualization in play | Tasks 4.4, 5.2 |
| §7 Per-game customizations list | Task 2.4 |
| §8 Out of scope / Kept | (acknowledged — no tasks; nothing built outside scope) |
| §9 Milestone outline | (this entire plan) |

All sections covered.

## Placeholder scan

No `TBD`, `TODO`, or `implement later` markers. Every code block contains the actual code the engineer should write.

## Type-name consistency

- `ButtonLayout`, `OrientationLayout`, `ButtonId`, `GlobalSettings`, `RomSettings`, `ResolvedSettings`, `HapticsMode`, `ControlLayout` defined in Task 2.1 — re-imported (not redefined) in Tasks 4.3, 5.1, 5.3, 5.4.
- `Sheet`, `ActionSheet`, `Modal`, `Prompt`, `FAB`, `Slider`, `SegmentedControl`, `Carousel`, `StatusPill` defined in Tasks 1.6–1.14 — re-imported via the `./primitives` barrel from Task 1.15.
- `useLongPress`, `useSafeArea`, `useHaptics` defined in Tasks 1.3–1.5 — re-imported from `./hooks/...`.
- `gradientForName` defined in Task 3.1, used in Tasks 3.3 and 4.2.
- `clampToSafeArea`, `DEFAULT_PORTRAIT`, `DEFAULT_LANDSCAPE`, `DEFAULT_BUTTON_LAYOUT`, `deepClone` defined in Task 5.1, used in Tasks 5.3, 5.4.
- `resolveSettings`, `useResolvedSettings`, `loadGlobal`, `saveGlobal`, `loadRom`, `saveRom`, `clearRom`, `listRomOverrides`, `effectiveControlLayout`, `useOrientation`, `useGlobalSettings`, `DEFAULT_SETTINGS` defined in Task 2.1.

All type and function names are stable across tasks.


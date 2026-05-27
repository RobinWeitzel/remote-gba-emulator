# Native-app feel redesign — design spec

**Date:** 2026-05-27
**Goal:** Make Play-Together GBA feel like a real mobile/tablet emulator app, not a website.
**Approach:** Design-system + staged rewrite of the two main surfaces (Home, Play) plus a new Settings surface and a button-layout editor. No new heavy deps. All work client-side; the server contract is untouched.

---

## 1. North star

- **Touch-first.** Phone and tablet are the design targets. Desktop renders the same touch UI at a capped, centered width (with the existing keyboard mapping). No bespoke desktop layout.
- **Less is more.** Strip header chrome, hide everything that isn't the game during play, big touch targets, gestures and sheets for everything else.
- **Per-game settings.** Customizations follow the ROM, not the save, and live in `localStorage` so they're device-local.
- **Live button editor.** Drag-to-position, pinch/handle-to-resize, per-orientation, reachable without joining a session.

---

## 2. Information architecture

**Primary surfaces (full screen):**

| Route             | Purpose                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `/`               | Home — swipeable carousel of saves, FAB to create, gear → Settings.     |
| `/s/<saveId>`     | Play — fullscreen game, peek sheet at bottom, no header.                |
| `/settings`       | Global app settings (player, defaults, archived saves, per-game list).  |
| `/edit-controls`  | Button-layout editor. Query: `scope=global` or `scope=rom:<romId>`.     |
| `/spike`          | Unchanged.                                                              |

**Sheets / overlays (transient, on top of a surface):**

- **Save action sheet** — long-press a home card. Per-game settings + Rename / Download / Archive / Delete.
- **In-game peek sheet** — always visible during Play; drag up to expand.
- **New-save sheet** — opened by Home FAB.
- **Player-edit sheet** — opened by Home avatar tap.

**What goes away from today's UI:**

- The dense in-game header (back, save name, role, conn state, handover, speed, mute, layout picker, roster — all 9 items move into the peek/expanded sheet).
- `window.confirm` / `window.prompt` everywhere (replaced by `<ActionSheet>` and `<Prompt>`).
- The inline "Start a new save" form on Home (moves into the new-save sheet).
- The "How it works" cards on Home (move into onboarding).
- The Home footer (version + `/spike` link).
- The archived-saves accordion on Home (moves to Settings).

---

## 3. Design system primitives

A small, hand-built set in `client/src/ui/primitives/`. CSS tokens in `client/src/ui/tokens.css`. No `framer-motion`, no `vaul` — hand-rolled CSS transitions and a tiny spring helper for sheet drag.

**Tokens (`--app-*`):**
- Radii: `--r-sm: 10px`, `--r-md: 14px`, `--r-lg: 18px`, `--r-xl: 24px`.
- Surfaces: `--bg-0` (page), `--bg-1` (card), `--bg-2` (sheet), `--bg-3` (elevated). Dark by default.
- Motion: `--ease-app: cubic-bezier(.32,.72,0,1)`, `--dur-fast: 140ms`, `--dur-base: 220ms`, `--dur-sheet: 320ms`.
- Touch: `--tap-min: 44px`.
- Depth: four shadow tiers (`--sh-1`…`--sh-4`).
- Safe-area: full-screen surfaces wrap in `env(safe-area-inset-*)`.

**Components:**

| Primitive          | Purpose                                                                                |
| ------------------ | -------------------------------------------------------------------------------------- |
| `<Sheet>`          | Bottom sheet with `peek` / `expanded` / `closed` states. Drag to resize. Backdrop scrim. |
| `<ActionSheet>`    | Opinionated sheet for "list of actions with destructive last." Replaces every confirm. |
| `<Modal>`          | Full-screen modal (onboarding, editor, needs-tap).                                     |
| `<Prompt>`         | Inline text-entry sheet replacing `window.prompt`.                                     |
| `<Carousel>`       | Horizontal snap-scroll + dot indicators. Pure CSS scroll-snap + thin JS controller.    |
| `<FAB>`            | Single floating primary action button per surface.                                     |
| `<Slider>`         | Touch-friendly range input with value bubble. Used in editor + settings.               |
| `<SegmentedControl>` | iOS-style picker. Layout pref, editor orientation, speed default.                    |
| `<StatusPill>`     | Small floating pill for transient status (reconnecting, speed change, handover).       |
| `<Avatar>`         | Existing, restyled to new tokens.                                                      |

**Hooks:**
- `useHaptics()` — wraps `navigator.vibrate`, respects haptics setting.
- `useSheet()` — drag/snap state machine for `<Sheet>`.
- `useSafeArea()` — exposes safe-area insets as numbers.
- `useLongPress(handler, ms = 500)` — for home-card long-press.

**File layout:**

```
client/src/ui/
  primitives/         ← new
    Sheet.tsx, ActionSheet.tsx, Modal.tsx, Prompt.tsx,
    Carousel.tsx, FAB.tsx, Slider.tsx, SegmentedControl.tsx,
    StatusPill.tsx, index.ts
  hooks/              ← new
    useHaptics.ts, useSheet.ts, useSafeArea.ts, useLongPress.ts
  HomePage.tsx        ← rewritten
  SessionPage.tsx     ← rewritten
  SettingsPage.tsx    ← new
  ButtonEditor.tsx    ← new (the /edit-controls page)
  Gamepad.tsx         ← extended (reads custom layout from settings)
  Avatar.tsx          ← restyled
  icons.tsx           ← extended
  tokens.css          ← new
  primitives.css      ← new
  home.css            ← new
  session.css         ← new
  settings.css        ← new
  editor.css          ← new
  styles.css          ← shrinks to global resets + cross-cutting only
```

---

## 4. Home screen

**Default state (≥ 1 save):**

- Full-bleed background — subtle gradient deterministically derived from the active card's save name (so each save has a visual identity without art).
- Top bar:
  - Left: avatar — tap opens player-edit sheet (`<Prompt>` for name).
  - Right: gear → `/settings`.
- Hero region (top ~60% of viewport): swipeable carousel, one save card at a time, snap-scroll. Each card shows save name, ROM chip, last-played relative time, live indicator, top 3 contributors with avatars + minutes. Primary CTA fills the bottom of the card: **Continue** / **Join** / **Open**.
- Dot indicator below the carousel.
- FAB (bottom-right): `+` opens the new-save sheet.

**Onboarding (first run):**

Full-screen `<Modal>`, paginated mini-carousel:
1. "Hi — what should we call you?" Name field, big Continue.
2. "Here's how it works." Three icons + sentences (pick a save / first in plays / time is credited).
3. "Pick a ROM to start your first save." Name field + ROM picker + Create.

After step 3, navigate directly to the new save's Play screen.

**Empty state (named, no saves):**

Carousel collapses to a single dashed-outline "Start your first save" card with a `+`. FAB still present.

**Long-press a card:**

`<ActionSheet>` from bottom. Order:
- **Settings for this game** (chevron — opens the per-game settings sheet).
- Rename…
- Download save state…
- Archive
- — separator —
- **Delete forever…** (destructive).

**New-save sheet (FAB):**

`<Sheet>` at modal height. Fields: save name, ROM picker. Primary "Create save."

**Archived saves:**

Moved out of Home. Visible in **Settings → Archived saves**. Tap a row → action sheet with Restore / Rename / Download / Delete.

---

## 5. Play screen

**Default running view (controller or follower):**

- No header. Fullscreen is requested on tap-start (today's behavior).
- Canvas centered, sized to fit. Background: same name-tinted gradient as the save's home card.
- On-screen gamepad in the resolved layout, reading session > per-game > global > built-in.
- **Peek sheet** at the bottom, always visible, ~52pt tall. Single row:
  - Left: roster avatars (overlapping, max 4, `+N` overflow). Tap → expand sheet to Players section.
  - Middle: live status text + colored dot — "Mia is playing" / "You're playing" / "Waiting for a controller" / "Connecting…".
  - Right: speed pill (button for controller, read-only for follower). Tap → controller cycles; follower expands sheet.
- Drag the sheet up (or tap the chevron handle) → expanded sheet.

**Expanded sheet (~75% height):**

Sections top to bottom:
1. **Now playing** — save name (large), ROM chip, role pill, connection state. Right-aligned: "Exit to home" button.
2. **Players** — full roster as a list. Controller-only: tap a watcher → inline "Hand controls to <name>?" confirm. This replaces today's header dropdown.
3. **Controls** — `<SegmentedControl>` for Layout (Side / Overlay / Stacked). Changes here are session-only by default; an inline "Save as default for this game" affordance promotes the current value into `settings.rom.<romId>`. Row "Customize buttons for this game…" → opens `/edit-controls?scope=rom:<romId>`. Below: speed control — `– 1× +` stepper for the controller, read-only pill for followers.
4. **Audio** — mute toggle; haptics override.
5. **Settings for this game** — small card. "Applies to every save using <ROM name> on this device." Toggle "Use my global defaults" resets per-game overrides for this ROM.

**Status pill (transient, top center):**

Replaces today's `.conn-banner`. Animates in/out for:
- Connection lost / reconnecting.
- Speed change initiated by a remote controller ("Now 2×").
- "You're in control now" on a handover (with brief haptic).

**Needs-tap overlay:**

Same role as today (audio unlock + fullscreen + orientation lock + wake lock). Restyled as a full-bleed `<Modal>` with the new tokens. Functionally identical; just snapped to the design system.

**What goes away:**

- The entire `.play-header` row.
- Handover dropdown (moves to Players section in expanded sheet).
- Layout picker `⚙` dropdown (moves to Controls section).
- `#saveId` chip (low value at runtime; kept in the "Now playing" sub-text).

---

## 6. Settings architecture

Three tiers, with clear ownership.

### Tier 1 — Global app settings (`/settings`)

Scrollable, sectioned page. Sections:

- **Player.** Avatar preview + name (tap → `<Prompt>` to edit).
- **Defaults** — apply to every save that hasn't overridden them.
  - Control layout: `<SegmentedControl>` Auto / Side / Overlay / Stacked. Auto = today's orientation-driven rule.
  - Default button layout: current size/opacity readout; "Customize…" row → `/edit-controls?scope=global`.
  - Haptics: on/off + Strong / Light / Off `<SegmentedControl>`.
  - Sound feedback: button-tap click on/off.
  - **Per-game customizations (N)** — opens a list view of ROMs with overrides (see §7).
- **Archived saves.** Collapsible list. Tap → action sheet (Restore / Rename / Download / Delete).
- **About.** Version, GitHub link, link to `/spike`. No telemetry.

### Tier 2 — Per-game settings (sheet)

Opened from home-card long-press OR in-game expanded sheet OR Settings → Per-game customizations row. Same sheet contents from all entry points. Fields, each labeled "Uses global default" until overridden:

- Control layout override (segmented; "Use global" as a 5th option).
- Custom button layout — "Customize for this game…" → `/edit-controls?scope=rom:<romId>`.
- Speed default: `<SegmentedControl>` 1× / 2× / 4× / 8× / Use global.
- Audio default: start muted (yes / no / Use global).
- Haptics override: Use global / Strong / Light / Off.
- Bottom: "Reset to global defaults" (destructive accent) — wipes the entire `settings.rom.<romId>` key.

### Tier 3 — In-game session-only

Three knobs are explicitly "for this session, don't persist": current speed (controller only), current mute, current layout. Changing them does not write to `settings.rom.*`. Each has a small "Save as default for this game" affordance that, when tapped explicitly, promotes the current value into the persisted per-game override.

### Resolution order (highest priority first)

1. Session-only override (in-game sheet, in-memory).
2. Per-game override (`settings.rom.<romId>` on this device).
3. Global default (`settings.global` on this device).
4. Built-in default (shipped in code).

### Storage layout (`localStorage`)

- `settings.global` — JSON: `{ controlLayout, buttonLayout, haptics, soundFeedback }`. Today's `settings.controlLayout` key is migrated into this on first read.
- `settings.rom.<romId>` — JSON: `{ controlLayout?, buttonLayout?, speedDefault?, startMuted?, haptics? }`. Only keys the user overrode are present.
- `player.name` — existing, untouched.

### Sweep behavior

- Save deleted: nothing to sweep (per-game, not per-save).
- ROM removed from server: `settings.rom.<romId>` becomes orphaned, kept (re-adding the ROM restores its settings).
- "Reset to global defaults" in the per-game sheet: delete `settings.rom.<romId>`.

---

## 7. Button editor (`/edit-controls`)

### Entry points (all land on the same screen)

1. **Settings → Defaults → "Customize default button layout"** → `/edit-controls?scope=global`.
2. **Settings → Defaults → "Per-game customizations" → [pick a ROM]** → `/edit-controls?scope=rom:<romId>`. ROM picker reads `/api/roms`; user need never have played the game.
3. **In-game expanded sheet → "Customize buttons for this game"** → `/edit-controls?scope=rom:<romId>`. Session keeps running in the background (WS stays open). On Save/Cancel, pop back to the running session — no rejoin.

### Editor screen

- **Center:** a white placeholder rectangle at the GBA's 240×160 aspect ratio, scaled to roughly the size the real canvas would render at on this device. Lets the user judge thumb positions against where the visible game would be — without ever needing a running game.
- **Pad:** rendered in whatever layout currently resolves for the scope (per-game's own override if any, else global, else built-in).
- **Top bar:** scope label ("Default layout" or "Pokémon Emerald") + orientation `<SegmentedControl>` (Portrait / Landscape) so the user can edit both without rotating the device.
- **Bottom bar:** opacity slider · grid-snap toggle · Reset orientation · Cancel · Save (primary).

### Interactions

- Each button has a drag handle (center) and a corner handle (resize). Selected button outlines + shows numeric size.
- Light haptic on pickup; snap haptic on alignment-guide crossings.
- Alignment guides appear when buttons align vertically/horizontally or hit symmetric positions.
- Safe-area clamping — buttons can't be dragged into notch/home-bar zones.
- Grid-snap toggle (off by default; enables 4% grid).

### Layout data model

```ts
type ButtonId = "dpad" | "a" | "b" | "l" | "r" | "start" | "select";

interface OrientationLayout {
  buttons: Record<ButtonId, { x: number; y: number; size: number }>;
  // x, y: 0–100 (% of short-axis viewport).
  // size: 0.5–2.0 multiplier of base button size.
  opacity: number; // 0.3–1.0, applies to the whole pad layer.
}

interface ButtonLayout {
  schemaVersion: 1;
  orientations: { portrait: OrientationLayout; landscape: OrientationLayout };
}
```

### Visualization in normal play

- `Gamepad.tsx` reads the resolved `ButtonLayout` and applies it via CSS custom properties on its container (`--btn-a-x`, `--btn-a-y`, `--btn-a-size`, …, `--pad-opacity`).
- Today's `[data-layout="..."]` rules in `styles.css` become **starting positions**; resolved per-button vars override them.
- If no `buttonLayout` override is set, no vars are emitted and today's rules apply unchanged.

### "Per-game customizations" list (in Settings)

- One row per ROM with any override. Each row: ROM name, small icon, Modify / Reset actions.
- Footer: "+ Add customization for another game" → ROM picker → editor.
- Empty state: "No per-game customizations yet" + the same picker.

---

## 8. Out of scope

Explicit non-goals so the implementation plan doesn't grow.

**Not in scope:**
- Offline / service worker / cache.
- Display options (palette, integer scale, CRT/LCD filter, screen border art).
- Save state slots (manual mid-game slots).
- Cloud sync of per-game customizations.
- Light theme / system theme (tokens make this trivial later, not built now).
- i18n / multi-language.
- Layout sharing (export/import, share-via-URL).
- Per-button rotation / colors / adding or removing buttons (always all 7).
- Desktop-specific UI (touch UI at capped width is desktop's experience).
- Server schema changes — save store, contributor ledger, snapshots, WS protocol all untouched.
- Formal screen-reader pass beyond keeping today's ARIA + adding tap-target sizing and focus states for primitives.
- Animation library (`framer-motion`, `vaul`, etc.).

**Kept exactly as today:**
- WS protocol, snapshot cadence, controller queue, contributor minute-tracking, handover semantics, speed sync.
- COOP/COEP headers, ROM hashing, `/spike` page, PWA manifest, no service worker.
- The mGBA WASM wrapper (`loadMgba.ts`) and its API surface.
- Keyboard input mapping (`KEY_MAP` in `Gamepad.tsx`).
- The `pagehide` cleanup, wake-lock, fullscreen, orientation lock on tap-start.

---

## 9. Milestone outline (for the implementation plan)

The implementation plan will turn each of these into ordered steps. Listed here for context only:

1. **M1 — Design tokens + primitives.** Land `tokens.css`, `Sheet`, `ActionSheet`, `Modal`, `Prompt`, `FAB`, `Carousel`, `Slider`, `SegmentedControl`, `StatusPill`, hooks. Style-only changes; nothing wired up. Verifiable by a small primitives demo route (or temporarily in `/spike`).
2. **M2 — Settings page + per-game storage.** Land `/settings`, the global defaults, the per-game settings sheet, the storage layer (with migration of today's `settings.controlLayout`). Wire `Gamepad.tsx` to read the resolved layout (no editor yet — values can only change via segmented controls).
3. **M3 — Home rewrite.** Carousel home + FAB + long-press action sheet + new-save sheet + onboarding modal. Replace all `window.confirm`/`prompt` on this surface.
4. **M4 — Play rewrite.** Peek sheet + expanded sheet + status pill. Remove `.play-header`. Replace `.conn-banner` with `<StatusPill>`. Migrate handover, speed cycle, mute, layout pref into the sheet.
5. **M5 — Button editor.** `/edit-controls` route, layout data model, drag/resize handles, alignment guides, grid snap, safe-area clamping, CSS-var wiring in `Gamepad.tsx`. Per-game customizations list view in Settings.
6. **M6 — Polish.** Haptics wiring, sound feedback, transition tuning, light final pass across all surfaces. Smoke-test on iOS Safari + Android Chrome + desktop.

Each milestone is independently shippable — at any stop, the app is consistent (no half-redesigned surfaces).

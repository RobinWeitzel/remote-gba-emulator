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

export function useGlobalSettings(): {
  settings: GlobalSettings;
  setSettings: (next: GlobalSettings) => void;
  patch: (delta: Partial<GlobalSettings>) => void;
  refresh: () => void;
} {
  const [settings, setS] = useState<GlobalSettings>(loadGlobal);
  const setSettings = (next: GlobalSettings) => { saveGlobal(next); setS(next); };
  const patch = (delta: Partial<GlobalSettings>) => {
    const next = { ...settings, ...delta };
    saveGlobal(next);
    setS(next);
  };
  const refresh = () => setS(loadGlobal());
  return { settings, setSettings, patch, refresh };
}

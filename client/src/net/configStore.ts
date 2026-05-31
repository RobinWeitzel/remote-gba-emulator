// Firebase config is provided BY THE USER in-app and kept LOCALLY — never baked
// into the GitHub Pages build (which would let any visitor burn the owner's free
// quota). A user's "own" config is the project they HOST games on; sessions they
// were invited to carry their own config (from the invite link, stored per
// session). See inviteCodec.ts + sessionStore.ts.

import type { FirebaseConfigLike } from "./adapter";

const OWN_CONFIG_KEY = "gba.ownConfig";

// Keep only the fields the adapter needs (and `emulators` for local dev). This
// is also exactly what travels in an invite link, so keep it minimal.
export function normalizeConfig(raw: any): FirebaseConfigLike {
  const cfg: FirebaseConfigLike = {
    apiKey: String(raw.apiKey ?? ""),
    authDomain: raw.authDomain ? String(raw.authDomain) : undefined,
    databaseURL: String(raw.databaseURL ?? ""),
    projectId: String(raw.projectId ?? ""),
    appId: raw.appId ? String(raw.appId) : undefined,
  };
  if (raw.emulators) cfg.emulators = raw.emulators;
  return cfg;
}

export function isUsableConfig(cfg: FirebaseConfigLike | null | undefined): cfg is FirebaseConfigLike {
  return !!cfg && !!cfg.apiKey && !!cfg.databaseURL && !!cfg.projectId &&
    cfg.apiKey !== "YOUR_FIREBASE_API_KEY";
}

export function getOwnConfig(): FirebaseConfigLike | null {
  try {
    const raw = localStorage.getItem(OWN_CONFIG_KEY);
    if (!raw) return null;
    const cfg = normalizeConfig(JSON.parse(raw));
    return isUsableConfig(cfg) ? cfg : null;
  } catch {
    return null;
  }
}

export function setOwnConfig(cfg: FirebaseConfigLike): void {
  localStorage.setItem(OWN_CONFIG_KEY, JSON.stringify(normalizeConfig(cfg)));
}

export function clearOwnConfig(): void {
  localStorage.removeItem(OWN_CONFIG_KEY);
}

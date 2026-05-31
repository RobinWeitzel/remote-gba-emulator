// Loads the Firebase web config at RUNTIME from a same-origin
// `firebase-config.json` (DECISIONS D3) so the user can deploy the prebuilt
// static bundle and just drop in their project's config — no rebuild. The
// config is not a secret (§4); the rules are the fence (§6). Fetched
// same-origin, so it's COEP-safe under cross-origin isolation.

import type { FirebaseConfigLike } from "./adapter";

export class MissingConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "MissingConfigError";
  }
}

const PLACEHOLDER = "YOUR_FIREBASE_API_KEY";

export async function loadFirebaseConfig(): Promise<FirebaseConfigLike> {
  const url = `${import.meta.env.BASE_URL}firebase-config.json`;
  let raw: any;
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (e) {
    throw new MissingConfigError(
      "Couldn't load firebase-config.json. Copy firebase-config.example.json to " +
        "firebase-config.json and fill in your Firebase project's web config (see README).",
    );
  }
  if (!raw || !raw.apiKey || raw.apiKey === PLACEHOLDER || !raw.databaseURL) {
    throw new MissingConfigError(
      "firebase-config.json is still the placeholder. Fill in your Firebase " +
        "project's apiKey, databaseURL, and projectId (see README → Firebase setup).",
    );
  }
  return raw as FirebaseConfigLike;
}

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

// The Firebase console hands you a JavaScript object (unquoted keys, maybe a
// `const firebaseConfig = {...};` wrapper and trailing commas) — not JSON. To
// save everyone the gotcha, accept that format too: try strict JSON first, then
// fall back to a relaxed parse that quotes bare keys and strips the wrapper.
export function parseConfigText(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    /* fall through to relaxed parse */
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no config object found");
  const objText = text.slice(start, end + 1);
  const relaxed = objText
    // quote a bare identifier key that follows `{` or `,` (won't touch the
    // `:` inside quoted URL values, which are preceded by `"`)
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    // drop trailing commas before } or ]
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(relaxed);
}

export async function loadFirebaseConfig(): Promise<FirebaseConfigLike> {
  const url = `${import.meta.env.BASE_URL}firebase-config.json`;
  let raw: any;
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = parseConfigText(await res.text());
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

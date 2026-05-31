// Multi-config backend registry. A user can host on their OWN Firebase project
// AND be a member of sessions hosted on OTHER people's projects (config arrives
// in the invite link). Each distinct project gets ONE adapter (one Firebase
// app, one stable anonymous identity). Adapters are cached by projectId.
//
// There is NO build-time / global config any more — config is always supplied
// by the caller (the user's own config, or a session's config). This is what
// stops a random visitor to the app URL from consuming the owner's free quota.

import { createBackendAdapter } from "./firebaseAdapter";
import type { BackendAdapter, FirebaseConfigLike } from "./adapter";

const adapters = new Map<string, BackendAdapter>();
const initPromises = new Map<string, Promise<BackendAdapter>>();

// Get (and lazily initialise) the adapter for a given config's project.
export function getBackend(config: FirebaseConfigLike): Promise<BackendAdapter> {
  const key = config.projectId;
  if (!key) return Promise.reject(new Error("config has no projectId"));
  const existing = initPromises.get(key);
  if (existing) return existing;
  const p = (async () => {
    const a = createBackendAdapter();
    await a.init(config);
    await a.signInAnonymously();
    adapters.set(key, a);
    return a;
  })().catch((e) => {
    initPromises.delete(key); // allow retry
    throw e;
  });
  initPromises.set(key, p);
  return p;
}

// Already-initialised adapter for a project, or null.
export function maybeBackend(projectId: string): BackendAdapter | null {
  return adapters.get(projectId) ?? null;
}

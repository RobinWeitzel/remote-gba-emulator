// Firebase Realtime Database implementation of the BackendAdapter (§3–6).
//
// Everything lives in RTDB on the Spark free plan — no Cloud Functions, no
// Cloud Storage (§4). Identity is Firebase Anonymous Auth: the SDK persists the
// anonymous credential in IndexedDB, so the same UID — the durable "member
// credential" (§7) — survives reloads and reconnects. The capability model
// (owner / single-use invite / member) is enforced by Security Rules (§6),
// authored and emulator-tested in M2; this adapter performs the client half
// (atomic invite redemption via transaction, etc.).
//
// Data model: SPEC-SERVERLESS §5.

import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously as fbSignInAnonymously,
  onAuthStateChanged,
  connectAuthEmulator,
  type Auth,
} from "firebase/auth";
import {
  getDatabase,
  connectDatabaseEmulator,
  ref,
  child,
  get,
  set,
  update,
  remove,
  push,
  onValue,
  onChildAdded,
  runTransaction,
  onDisconnect,
  serverTimestamp,
  query,
  orderByKey,
  startAfter,
  type Database,
  type DatabaseReference,
} from "firebase/database";
import type {
  BackendAdapter,
  FirebaseConfigLike,
  InputMsg,
  InviteRef,
  MemberId,
  RosterMember,
  SaveData,
  SaveMeta,
  SessionId,
  SessionMeta,
  SnapshotMsg,
  SpeedMsg,
  Unsub,
} from "./adapter";

const MEMBER_ID_KEY = "gba.memberId";
// Distinct Firebase app name per adapter instance so multiple adapters can
// coexist in one process (e.g. two simulated devices in an integration test);
// initializeApp throws on a duplicate default app.
let appCounter = 0;
const HEARTBEAT_MS = 5000;
// A member is "online" if their lastSeen is within this window. onDisconnect
// removes lastSeen on a clean drop; the window covers a missed heartbeat or two
// during a flaky-cellular blip before we treat them as gone.
const PRESENCE_TIMEOUT_MS = 15000;

export class FirebaseAdapter implements BackendAdapter {
  private app: FirebaseApp | null = null;
  private auth: Auth | null = null;
  private db: Database | null = null;
  private uid: MemberId | null = null;
  private authReady: Promise<void> | null = null;

  private sessionId: SessionId | null = null;
  private meta: SessionMeta | null = null;
  private owner = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private unsubs = new Set<Unsub>();

  // ---- identity / lifecycle ----
  async init(config: FirebaseConfigLike): Promise<void> {
    this.app = initializeApp(
      {
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        databaseURL: config.databaseURL,
        projectId: config.projectId,
        appId: config.appId,
      },
      `gba-${Date.now()}-${appCounter++}`,
    );
    this.auth = getAuth(this.app);
    this.db = getDatabase(this.app);

    if (config.emulators?.auth) {
      connectAuthEmulator(this.auth, config.emulators.auth, { disableWarnings: true });
    }
    if (config.emulators?.database) {
      connectDatabaseEmulator(this.db, config.emulators.database.host, config.emulators.database.port);
    }

    // Settle the initial (possibly persisted) auth state so currentMemberId()
    // is meaningful right after init.
    this.authReady = new Promise<void>((resolve) => {
      const unsub = onAuthStateChanged(this.auth!, (user) => {
        this.uid = user?.uid ?? null;
        if (this.uid) {
          try { localStorage.setItem(MEMBER_ID_KEY, this.uid); } catch { /* ignore */ }
        }
        resolve();
        unsub();
      });
    });
    await this.authReady;
  }

  async signInAnonymously(): Promise<MemberId> {
    if (!this.auth) throw new Error("adapter not initialised");
    if (this.uid) return this.uid;
    const cred = await fbSignInAnonymously(this.auth);
    this.uid = cred.user.uid;
    try { localStorage.setItem(MEMBER_ID_KEY, this.uid); } catch { /* ignore */ }
    return this.uid;
  }

  getStoredMemberId(): MemberId | null {
    try { return localStorage.getItem(MEMBER_ID_KEY); } catch { return null; }
  }

  // Test-only: force an ungraceful disconnect/reconnect so onDisconnect handlers
  // fire on the server (used by integration tests to exercise drop handoff).
  async __simulateDropForTest(): Promise<void> {
    if (!this.db) return;
    const { goOffline } = await import("firebase/database");
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    goOffline(this.db);
  }
  async __reconnectSocketForTest(): Promise<void> {
    if (!this.db) return;
    const { goOnline } = await import("firebase/database");
    goOnline(this.db);
  }

  currentMemberId(): MemberId | null {
    return this.uid;
  }

  private requireSession(): { db: Database; sessionId: SessionId; uid: MemberId } {
    if (!this.db) throw new Error("adapter not initialised");
    if (!this.sessionId) throw new Error("no active session");
    if (!this.uid) throw new Error("not signed in");
    return { db: this.db, sessionId: this.sessionId, uid: this.uid };
  }

  private sref(path: string): DatabaseReference {
    if (!this.db || !this.sessionId) throw new Error("no active session");
    return ref(this.db, `sessions/${this.sessionId}/${path}`);
  }

  // ---- sessions ----
  async createSession(opts: { romHash: string; romName: string; name: string }): Promise<{ sessionId: SessionId }> {
    if (!this.db) throw new Error("adapter not initialised");
    const uid = await this.signInAnonymously();
    const sessionId = push(ref(this.db, "sessions")).key!;
    this.sessionId = sessionId;
    const now = serverTimestamp();
    // One multi-location write so the session is created atomically: owner,
    // meta, the owner as first member, and the owner holding the controller.
    await update(ref(this.db, `sessions/${sessionId}`), {
      "meta/owners": { [uid]: true },
      "meta/romHash": opts.romHash,
      "meta/romName": opts.romName,
      "meta/createdAt": now,
      "meta/speedMultiplier": 1,
      [`members/${uid}`]: { name: opts.name, joinedAt: now, lastSeen: now, owner: true },
      "controllerLock/holder": uid,
      "controllerLock/queue": { 0: uid },
      "controllerLock/updatedAt": now,
    });
    this.meta = { romHash: opts.romHash, romName: opts.romName, createdAt: Date.now(), ownerUid: uid };
    this.owner = true;
    this.setPresence();
    return { sessionId };
  }

  async joinViaInvite(invite: InviteRef, opts: { name: string }): Promise<{ sessionId: SessionId; memberId: MemberId }> {
    if (!this.db) throw new Error("adapter not initialised");
    const uid = await this.signInAnonymously();
    this.sessionId = invite.sessionId;

    // Atomic single-use redemption (§6): set redeemedBy only if currently
    // absent. Two simultaneous redeemers → exactly one winner; the loser's
    // transaction sees a non-null value and aborts.
    const redeemedRef = this.sref(`invites/${invite.inviteId}/redeemedBy`);
    const result = await runTransaction(redeemedRef, (current) => {
      if (current === null) return uid; // claim it
      return; // abort — already redeemed
    });
    if (!result.committed || result.snapshot.val() !== uid) {
      this.sessionId = null;
      throw new Error("This invite has already been used. Ask for a fresh invite link.");
    }
    await set(this.sref(`invites/${invite.inviteId}/redeemedAt`), serverTimestamp());

    // Become a member — rules verify viaInvite.redeemedBy === auth.uid (§6).
    const now = serverTimestamp();
    await set(this.sref(`members/${uid}`), {
      name: opts.name,
      viaInvite: invite.inviteId,
      joinedAt: now,
      lastSeen: now,
    });
    // Append to the handoff queue (join order).
    await runTransaction(this.sref("controllerLock/queue"), (q: MemberId[] | null) => {
      const arr = Array.isArray(q) ? q.slice() : q ? Object.values(q) : [];
      if (!arr.includes(uid)) arr.push(uid);
      return arr;
    });

    await this.loadMeta();
    this.setPresence();
    return { sessionId: invite.sessionId, memberId: uid };
  }

  async reconnect(sessionId: SessionId, opts: { name: string }): Promise<void> {
    if (!this.db) throw new Error("adapter not initialised");
    const uid = await this.signInAnonymously();
    this.sessionId = sessionId;
    const memberSnap = await get(this.sref(`members/${uid}`));
    if (!memberSnap.exists()) {
      this.sessionId = null;
      throw new Error("No membership for this device. You need a fresh invite to rejoin.");
    }
    await update(this.sref(`members/${uid}`), { name: opts.name, lastSeen: serverTimestamp() });
    await this.loadMeta();
    this.setPresence();
  }

  private async loadMeta(): Promise<void> {
    const snap = await get(this.sref("meta"));
    const v = snap.val();
    if (!v) { this.meta = null; this.owner = false; return; }
    this.meta = {
      romHash: v.romHash,
      romName: v.romName,
      createdAt: typeof v.createdAt === "number" ? v.createdAt : Date.now(),
      ownerUid: v.owners ? Object.keys(v.owners)[0] : "",
    };
    this.owner = !!(this.uid && v.owners && v.owners[this.uid] === true);
  }

  async getSessionMeta(sessionId: SessionId): Promise<SessionMeta | null> {
    if (!this.db) throw new Error("adapter not initialised");
    const snap = await get(ref(this.db, `sessions/${sessionId}/meta`));
    const v = snap.val();
    if (!v) return null;
    return {
      romHash: v.romHash,
      romName: v.romName,
      createdAt: typeof v.createdAt === "number" ? v.createdAt : Date.now(),
      ownerUid: v.owners ? Object.keys(v.owners)[0] : "",
    };
  }

  async leaveSession(): Promise<void> {
    const uid = this.uid;
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    for (const u of this.unsubs) { try { u(); } catch { /* ignore */ } }
    this.unsubs.clear();
    if (this.db && this.sessionId && uid) {
      try {
        // Release control if we hold it, and clear presence — gracefully.
        // (null-OR-uid: see releaseControl for why null must write null.)
        await runTransaction(this.sref("controllerLock/holder"), (h) =>
          h === null || h === uid ? null : undefined,
        );
        await remove(this.sref(`members/${uid}/lastSeen`));
      } catch { /* ignore */ }
    }
    this.sessionId = null;
    this.meta = null;
    this.owner = false;
  }

  // ---- capability ----
  async mintInvite(): Promise<InviteRef> {
    const { uid, sessionId } = this.requireSession();
    if (!this.owner) throw new Error("Only the owner can create invites.");
    const inviteRef = push(this.sref("invites"));
    const inviteId = inviteRef.key!;
    await set(inviteRef, { createdBy: uid, createdAt: serverTimestamp() });
    return { sessionId, inviteId };
  }

  isOwner(): boolean {
    return this.owner;
  }

  // ---- roster / presence ----
  onRoster(cb: (members: RosterMember[]) => void): Unsub {
    const r = this.sref("members");
    const off = onValue(r, (snap) => {
      const v = snap.val() ?? {};
      const now = Date.now();
      const members: RosterMember[] = Object.entries<any>(v).map(([id, m]) => {
        const lastSeen = typeof m.lastSeen === "number" ? m.lastSeen : 0;
        return {
          id,
          name: m.name ?? "Player",
          joinedAt: typeof m.joinedAt === "number" ? m.joinedAt : 0,
          lastSeen,
          online: lastSeen > 0 && now - lastSeen < PRESENCE_TIMEOUT_MS,
        };
      });
      members.sort((a, b) => a.joinedAt - b.joinedAt);
      cb(members);
    });
    this.unsubs.add(off);
    return () => { off(); this.unsubs.delete(off); };
  }

  setPresence(): void {
    const { uid } = this.requireSession();
    const lastSeenRef = this.sref(`members/${uid}/lastSeen`);
    const holderRef = this.sref("controllerLock/holder");
    // On an ungraceful drop, clear our presence AND release the controller lock
    // so the next-in-queue can claim it (§7, §11 handoff on drop).
    onDisconnect(lastSeenRef).remove().catch(() => {});
    onDisconnect(holderRef).set(null).catch(() => {});
    // Heartbeat keeps lastSeen fresh so others see us as online.
    const beat = () => { set(lastSeenRef, serverTimestamp()).catch(() => {}); };
    beat();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(beat, HEARTBEAT_MS);
  }

  // ---- control ----
  async claimControl(): Promise<boolean> {
    const { uid } = this.requireSession();
    const res = await runTransaction(this.sref("controllerLock/holder"), (current) => {
      if (current === null || current === undefined) return uid; // free → claim
      if (current === uid) return uid; // already ours
      return; // held by someone else → abort
    });
    const won = res.committed && res.snapshot.val() === uid;
    if (won) {
      await set(this.sref("controllerLock/updatedAt"), serverTimestamp());
      // Ensure we're in the queue.
      await runTransaction(this.sref("controllerLock/queue"), (q: MemberId[] | null) => {
        const arr = Array.isArray(q) ? q.slice() : q ? Object.values(q) : [];
        if (!arr.includes(uid)) arr.push(uid);
        return arr;
      });
    }
    return won;
  }

  async releaseControl(): Promise<void> {
    const { uid } = this.requireSession();
    // NOTE the null-OR-uid handling: RTDB runs the transaction optimistically
    // against the (possibly empty → null) local cache first. Returning
    // `undefined` aborts FINALLY (no server re-run), so a naive `h === uid`
    // check aborts on the stale null and never releases. Treating null as
    // "already free, write null" lets RTDB re-run against the real value and
    // commit; only a lock genuinely held by SOMEONE ELSE is left untouched.
    await runTransaction(this.sref("controllerLock/holder"), (h) =>
      h === null || h === uid ? null : undefined,
    );
  }

  onControlChanged(cb: (holder: MemberId | null) => void): Unsub {
    const off = onValue(this.sref("controllerLock/holder"), (snap) => cb(snap.val() ?? null));
    this.unsubs.add(off);
    return () => { off(); this.unsubs.delete(off); };
  }

  // ---- sync relay ----
  sendInput(msg: Omit<InputMsg, "by">): void {
    const { uid } = this.requireSession();
    push(this.sref("sync/inputs"), { ...msg, by: uid });
  }

  sendSpeed(msg: Omit<SpeedMsg, "by">): void {
    const { uid } = this.requireSession();
    push(this.sref("sync/speed"), { ...msg, by: uid });
  }

  async publishSnapshot(snapshot: Omit<SnapshotMsg, "by" | "at">): Promise<void> {
    const { uid } = this.requireSession();
    // Overwrite — keep only the LATEST snapshot to bound storage/egress (§12).
    await set(this.sref("sync/snapshot"), { ...snapshot, by: uid, at: serverTimestamp() });
  }

  publishSpeedMeta(multiplier: number): void {
    this.requireSession();
    set(this.sref("meta/speedMultiplier"), multiplier).catch(() => {});
  }

  // onChildAdded replays existing children on attach; we ignore everything that
  // already existed (push keys are chronological) so a late joiner doesn't
  // re-apply stale relay traffic. Inputs/speed are pruned in M5.
  private onChildAfterNow<T>(path: string, map: (raw: any, key: string) => T, cb: (msg: T) => void): Unsub {
    const r = this.sref(path);
    let started = false;
    const off1 = onValue(query(r, orderByKey()), (snap) => {
      // Determine the last existing key, then listen only after it.
      if (started) return;
      started = true;
      let lastKey: string | null = null;
      snap.forEach((c) => { lastKey = c.key; return undefined as any; });
      const q = lastKey ? query(r, orderByKey(), startAfter(lastKey)) : query(r, orderByKey());
      const off2 = onChildAdded(q, (c) => { cb(map(c.val(), c.key!)); });
      this.unsubs.add(off2);
    }, { onlyOnce: true });
    this.unsubs.add(off1);
    return () => { off1(); };
  }

  onInput(cb: (msg: InputMsg) => void): Unsub {
    return this.onChildAfterNow("sync/inputs", (v) => v as InputMsg, cb);
  }

  onSpeed(cb: (msg: SpeedMsg) => void): Unsub {
    return this.onChildAfterNow("sync/speed", (v) => v as SpeedMsg, cb);
  }

  onSnapshot(cb: (msg: SnapshotMsg) => void): Unsub {
    const off = onValue(this.sref("sync/snapshot"), (snap) => {
      const v = snap.val();
      if (v) cb(v as SnapshotMsg);
    });
    this.unsubs.add(off);
    return () => { off(); this.unsubs.delete(off); };
  }

  // ---- persistence ----
  async saveDurable(slot: string, data: SaveData): Promise<void> {
    this.requireSession();
    const path = slot === "latest" ? "saves/latest" : `saves/slots/${slot}`;
    await set(this.sref(path), data);
  }

  async loadDurable(slot: string): Promise<SaveData | null> {
    this.requireSession();
    const path = slot === "latest" ? "saves/latest" : `saves/slots/${slot}`;
    const snap = await get(this.sref(path));
    return snap.exists() ? (snap.val() as SaveData) : null;
  }

  async listSaves(): Promise<SaveMeta[]> {
    this.requireSession();
    const snap = await get(this.sref("saves/slots"));
    const v = snap.val() ?? {};
    return Object.entries<any>(v).map(([slot, s]) => ({
      slot,
      frame: s.frame ?? 0,
      at: s.at ?? 0,
      name: s.name,
    }));
  }
}

// Convenience helper used by adapter selection (§16: BACKEND = "firebase-rtdb").
export function createBackendAdapter(): BackendAdapter {
  return new FirebaseAdapter();
}

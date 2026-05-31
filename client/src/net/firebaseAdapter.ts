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

import { initializeApp, getApp, getApps, type FirebaseApp } from "firebase/app";
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
  goOffline,
  goOnline,
  query,
  orderByKey,
  startAfter,
  type Database,
  type DatabaseReference,
  type OnDisconnect,
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
  private projectId = "";
  private authReady: Promise<void> | null = null;

  private sessionId: SessionId | null = null;
  private meta: SessionMeta | null = null;
  private owner = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private holderDisconnect: OnDisconnect | null = null;
  private unsubs = new Set<Unsub>();

  // ---- identity / lifecycle ----
  // The Firebase app NAME must be STABLE per project: Firebase Auth persists the
  // anonymous credential in IndexedDB keyed by (apiKey, appName), so a name that
  // changed each page load gave a NEW anonymous UID every reload → "not a
  // member" → permission denied. Use `gba-<projectId>` (stable, and distinct per
  // project so multiple owners' configs coexist). `instanceId` is only for
  // multi-device integration tests that need several adapters in one process.
  async init(config: FirebaseConfigLike, instanceId?: string): Promise<void> {
    const appName = `gba-${config.projectId}${instanceId ? `-${instanceId}` : ""}`;
    const appConfig = {
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      databaseURL: config.databaseURL,
      projectId: config.projectId,
      appId: config.appId,
    };
    this.projectId = config.projectId;
    this.app = getApps().some((a) => a.name === appName) ? getApp(appName) : initializeApp(appConfig, appName);
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
          try { localStorage.setItem(`${MEMBER_ID_KEY}.${this.projectId}`, this.uid); } catch { /* ignore */ }
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
    try { return localStorage.getItem(`${MEMBER_ID_KEY}.${this.projectId}`); } catch { return null; }
  }

  // Test-only: force an ungraceful disconnect/reconnect so onDisconnect handlers
  // fire on the server (used by integration tests to exercise drop handoff).
  async __simulateDropForTest(): Promise<void> {
    if (!this.db) return;
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    goOffline(this.db);
  }
  async __reconnectSocketForTest(): Promise<void> {
    if (!this.db) return;
    goOnline(this.db);
  }
  // Test-only: a raw DatabaseReference at an ABSOLUTE path, authed as THIS
  // adapter's user. Lets the rules tests attempt arbitrary (often illegal)
  // reads/writes as a specific identity to probe the security rules.
  __rawRef(absolutePath: string): DatabaseReference {
    if (!this.db) throw new Error("not initialised");
    return ref(this.db, absolutePath);
  }

  currentMemberId(): MemberId | null {
    return this.uid;
  }

  // On a FRESH page load, signInAnonymously() resolves before the new RTDB
  // connection has actually been handed the auth token, so the first rule-gated
  // read/write can be evaluated with auth == null → "permission_denied". The
  // SDK attaches the token a beat later. Retry the first authed op a few times
  // with short backoff so a refresh doesn't dump the user on an error page.
  private async withAuthRetry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < tries; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        const msg = String((e as any)?.message ?? e);
        if (!/permission[_ ]denied/i.test(msg)) throw e;
        await new Promise((r) => setTimeout(r, 100 * (i + 1)));
      }
    }
    throw lastErr;
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
    // Two ordered writes so the locked security rules (§6) bootstrap cleanly:
    // RTDB rule cross-references via `root` see PRE-write state, so the owner's
    // membership/controller writes must come AFTER `meta/owners` is committed.
    // Only the creator can touch this session at this point (no invite exists),
    // so the brief non-atomicity is invisible to anyone else.
    await this.withAuthRetry(() => update(ref(this.db!, `sessions/${sessionId}/meta`), {
      owners: { [uid]: true },
      romHash: opts.romHash,
      romName: opts.romName,
      createdAt: now,
      speedMultiplier: 1,
    }));
    await update(ref(this.db, `sessions/${sessionId}`), {
      [`members/${uid}`]: { name: opts.name, joinedAt: now, lastSeen: now, owner: true },
      "controllerLock/holder": uid,
      "controllerLock/queue": { 0: uid },
      "controllerLock/updatedAt": now,
    });
    this.meta = { romHash: opts.romHash, romName: opts.romName, createdAt: Date.now(), ownerUid: uid, speedMultiplier: 1 };
    this.owner = true;
    this.setPresence();
    // Owner holds the controller from creation → arm the drop-release.
    await this.armReleaseOnDisconnect();
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
    const result = await this.withAuthRetry(() =>
      runTransaction(redeemedRef, (current) => {
        if (current === null) return uid; // claim it
        return; // abort — already redeemed
      }),
    );
    // Success if redeemedBy is now OUR uid — whether we just won it (committed)
    // or had already redeemed it before (idempotent re-click of the link).
    if (result.snapshot.val() !== uid) {
      this.sessionId = null;
      throw new Error("This invite has already been used. Ask for a fresh invite link.");
    }
    // (No separate redeemedAt write — it would hit the now-redeemed invite and
    // the write-once rule would reject it. joinedAt on the member record is the
    // timestamp of record; redeemedBy alone enforces single-use.)

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
    // First authed read — also waits out the post-sign-in auth-propagation race.
    const memberSnap = await this.withAuthRetry(() => get(this.sref(`members/${uid}`)));
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
      speedMultiplier: typeof v.speedMultiplier === "number" ? v.speedMultiplier : 1,
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
      speedMultiplier: typeof v.speedMultiplier === "number" ? v.speedMultiplier : 1,
    };
  }

  async leaveSession(): Promise<void> {
    const uid = this.uid;
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    for (const u of this.unsubs) { try { u(); } catch { /* ignore */ } }
    this.unsubs.clear();
    if (this.db && this.sessionId && uid) {
      try {
        await this.cancelReleaseOnDisconnect();
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

  onConnected(cb: (connected: boolean) => void): Unsub {
    if (!this.db) throw new Error("adapter not initialised");
    const off = onValue(ref(this.db, ".info/connected"), (snap) => cb(snap.val() === true));
    this.unsubs.add(off);
    return () => { off(); this.unsubs.delete(off); };
  }

  setPresence(): void {
    const { uid } = this.requireSession();
    const lastSeenRef = this.sref(`members/${uid}/lastSeen`);
    // On an ungraceful drop, clear our presence. (The controller-lock release
    // onDisconnect is armed separately, only while we actually hold the lock —
    // see armReleaseOnDisconnect: the security rules validate an onDisconnect
    // write at REGISTRATION time, so a non-holder can't pre-arm a holder=null.)
    onDisconnect(lastSeenRef).remove().catch(() => {});
    const beat = () => { set(lastSeenRef, serverTimestamp()).catch(() => {}); };
    beat();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(beat, HEARTBEAT_MS);
  }

  // Arm "release the controller lock on ungraceful drop" (§11). MUST be called
  // only while we hold the lock, because the rules check the onDisconnect write
  // against current data when it is established — at which point
  // controllerLock/holder must already equal our uid for it to be accepted.
  private async armReleaseOnDisconnect(): Promise<void> {
    const holderRef = this.sref("controllerLock/holder");
    this.holderDisconnect = onDisconnect(holderRef);
    try { await this.holderDisconnect.set(null); } catch { /* ignore */ }
  }
  private async cancelReleaseOnDisconnect(): Promise<void> {
    if (!this.holderDisconnect) return;
    try { await this.holderDisconnect.cancel(); } catch { /* ignore */ }
    this.holderDisconnect = null;
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
      // Now that we hold the lock, arm the drop-release onDisconnect (passes the
      // rules because holder === our uid right now).
      await this.armReleaseOnDisconnect();
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
    // Cancel the drop-release onDisconnect first so it can't later null a lock
    // we've already handed off.
    await this.cancelReleaseOnDisconnect();
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

  onControllerState(cb: (s: { holder: MemberId | null; queue: MemberId[] }) => void): Unsub {
    const off = onValue(this.sref("controllerLock"), (snap) => {
      const v = snap.val() ?? {};
      const queue = Array.isArray(v.queue) ? v.queue : v.queue ? Object.values<MemberId>(v.queue) : [];
      cb({ holder: v.holder ?? null, queue });
    });
    this.unsubs.add(off);
    return () => { off(); this.unsubs.delete(off); };
  }

  // Directed handover (§11): put the target at the front of the queue, then
  // release. The next-in-queue auto-claim (in the UI) then routes control to
  // them. We can't set holder to someone else's uid directly (the rules only
  // allow setting it to our own uid or null), so this two-step is the path.
  async requestHandover(targetId: MemberId): Promise<void> {
    this.requireSession();
    await runTransaction(this.sref("controllerLock/queue"), (q: MemberId[] | null) => {
      const arr = Array.isArray(q) ? q.slice() : q ? Object.values<MemberId>(q) : [];
      const without = arr.filter((x) => x !== targetId);
      return [targetId, ...without];
    });
    await this.releaseControl();
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

  // onChildAdded replays existing children on attach; we want only NEW relay
  // traffic so a late joiner doesn't re-apply stale inputs (they bootstrap from
  // the snapshot instead). push().key generates a time-ordered id WITHOUT
  // writing; startAfter(it) bounds the listener to children created after now —
  // race-free, no initial read. Inputs/speed are pruned in M5.
  private onChildAfterNow<T>(path: string, map: (raw: any, key: string) => T, cb: (msg: T) => void): Unsub {
    const r = this.sref(path);
    const thresholdKey = push(r).key!;
    const q = query(r, orderByKey(), startAfter(thresholdKey));
    const off = onChildAdded(q, (c) => cb(map(c.val(), c.key!)));
    this.unsubs.add(off);
    return () => { off(); this.unsubs.delete(off); };
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

  // ---- free-tier guardrails (§12) ----
  // Clear the transient relay streams once a snapshot has superseded them — the
  // snapshot is the authority for late joiners, so accumulated inputs/speed are
  // pure egress/storage waste. Controller-only write (rules), called right after
  // publishSnapshot.
  async pruneRelay(): Promise<void> {
    this.requireSession();
    try {
      await update(this.sref("sync"), { inputs: null, speed: null });
    } catch { /* ignore — non-fatal */ }
  }

  // Owner-only teardown: remove the whole session subtree (rules gate this on
  // owner + deletion). Used to clean up an ended game so it doesn't sit against
  // the Spark storage cap.
  async deleteSession(): Promise<void> {
    if (!this.db || !this.sessionId) return;
    if (!this.owner) throw new Error("Only the owner can end and delete the session.");
    await this.cancelReleaseOnDisconnect();
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    for (const u of this.unsubs) { try { u(); } catch { /* ignore */ } }
    this.unsubs.clear();
    // Null each subtree explicitly. A single remove() of the session node is
    // rejected because RTDB evaluates the descendant .write rules on a subtree
    // delete (cascade does not bypass them in the emulator); the owner has an
    // admin override on each subtree's rule, so the multi-path null update
    // passes and the now-empty session node is auto-pruned.
    await update(ref(this.db, `sessions/${this.sessionId}`), {
      meta: null, invites: null, members: null, controllerLock: null, sync: null, saves: null,
    });
    this.sessionId = null;
    this.meta = null;
    this.owner = false;
  }
}

// Convenience helper used by adapter selection (§16: BACKEND = "firebase-rtdb").
export function createBackendAdapter(): BackendAdapter {
  return new FirebaseAdapter();
}

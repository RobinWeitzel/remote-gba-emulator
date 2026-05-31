// Backend adapter seam (SPEC-SERVERLESS §3).
//
// The existing sync/speed/handoff/reconciliation code depends ONLY on this
// interface, never on Firebase directly. Exactly one adapter is implemented
// now (Firebase RTDB, see firebaseAdapter.ts); the shape is deliberately
// transport-agnostic so Supabase/Ably could slot in later (§12 migration
// triggers) without touching app logic.
//
// The relay message shapes (input/speed/snapshot) are kept byte-for-byte
// compatible with the previous WebSocket protocol (shared/src/index.ts) so the
// sync logic is reused unchanged — only `by` (the author's member id) is added,
// which RTDB needs because there is no server stamping the sender.

import type { GbaButton } from "@gba/shared";

export type MemberId = string;
export type SessionId = string;
export type InviteId = string;

// What a shareable invite encodes. Travels in the invite URL (§7). `cfg` is an
// optional pointer that lets a cold joiner who has never opened the app connect
// to the right Firebase project; when omitted the app uses its bundled config.
export interface InviteRef {
  sessionId: SessionId;
  inviteId: InviteId;
}

export interface SessionMeta {
  romHash: string;
  romName: string;
  createdAt: number;
  ownerUid: MemberId;
  speedMultiplier: number;
}

export interface RosterMember {
  id: MemberId;
  name: string;
  joinedAt: number;
  lastSeen: number;
  online: boolean;
}

// ---- relay payloads (mirror shared/src/index.ts, + `by`) ----
export interface InputMsg {
  frame: number;
  button: GbaButton;
  pressed: boolean;
  by: MemberId;
}

export interface SpeedMsg {
  frame: number;
  multiplier: number;
  by: MemberId;
}

export interface SnapshotMsg {
  frame: number;
  data: string; // base64 (optionally gzip-compressed) save-state
  compressed: boolean;
  rawSize: number;
  multiplier: number;
  by: MemberId;
  at: number;
}

export interface SaveData {
  data: string; // base64 save-state
  frame: number;
  at: number;
  by: MemberId;
  name?: string;
}

export interface SaveMeta {
  slot: string;
  frame: number;
  at: number;
  name?: string;
}

export type Unsub = () => void;

// Firebase web config object (apiKey/authDomain/databaseURL/projectId/appId…).
// Not a secret (§4) — security comes from the rules, not from hiding this.
export interface FirebaseConfigLike {
  apiKey: string;
  authDomain?: string;
  databaseURL: string;
  projectId: string;
  appId?: string;
  // Test-only: point the SDK at local emulators instead of production.
  emulators?: {
    auth?: string; // e.g. "http://127.0.0.1:9099"
    database?: { host: string; port: number };
  };
}

export interface BackendAdapter {
  // identity / lifecycle. `instanceId` is only for tests needing several
  // adapters per process; the browser omits it (one stable app per project).
  init(config: FirebaseConfigLike, instanceId?: string): Promise<void>;
  signInAnonymously(): Promise<MemberId>; // durable per-device id
  getStoredMemberId(): MemberId | null; // best-effort, from local storage
  currentMemberId(): MemberId | null;

  // sessions
  createSession(opts: { romHash: string; romName: string; name: string }): Promise<{ sessionId: SessionId }>;
  joinViaInvite(invite: InviteRef, opts: { name: string }): Promise<{ sessionId: SessionId; memberId: MemberId }>;
  reconnect(sessionId: SessionId, opts: { name: string }): Promise<void>;
  leaveSession(): Promise<void>;
  getSessionMeta(sessionId: SessionId): Promise<SessionMeta | null>;

  // capability (owner-only)
  mintInvite(): Promise<InviteRef>; // single-use; owner only
  isOwner(): boolean;

  // roster / presence
  onRoster(cb: (members: RosterMember[]) => void): Unsub;
  setPresence(): void; // heartbeat + onDisconnect
  onConnected(cb: (connected: boolean) => void): Unsub; // RTDB .info/connected

  // control
  claimControl(): Promise<boolean>; // transaction; only if free / allowed
  releaseControl(): Promise<void>;
  onControlChanged(cb: (holder: MemberId | null) => void): Unsub;
  onControllerState(cb: (s: { holder: MemberId | null; queue: MemberId[] }) => void): Unsub;
  requestHandover(targetId: MemberId): Promise<void>; // queue target first, then release

  // sync relay (existing payloads, unchanged shapes + `by`)
  sendInput(msg: Omit<InputMsg, "by">): void;
  sendSpeed(msg: Omit<SpeedMsg, "by">): void;
  publishSnapshot(snapshot: Omit<SnapshotMsg, "by" | "at">): Promise<void>;
  publishSpeedMeta(multiplier: number): void; // mirror current speed for late joiners
  onInput(cb: (msg: InputMsg) => void): Unsub;
  onSpeed(cb: (msg: SpeedMsg) => void): Unsub;
  onSnapshot(cb: (msg: SnapshotMsg) => void): Unsub;

  // persistence (durable long-term saves)
  saveDurable(slot: string, data: SaveData): Promise<void>;
  loadDurable(slot: string): Promise<SaveData | null>;
  listSaves(): Promise<SaveMeta[]>;

  // free-tier guardrails (§12)
  pruneRelay(): Promise<void>; // clear superseded sync/inputs + sync/speed
  deleteSession(): Promise<void>; // owner-only teardown of the whole session
}

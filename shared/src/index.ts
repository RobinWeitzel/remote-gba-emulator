// Shared types between client and server. Single source of truth for the
// WebSocket protocol (SPEC §9) and the HTTP /api shape.

export type GbaButton =
  | "A"
  | "B"
  | "L"
  | "R"
  | "Start"
  | "Select"
  | "Up"
  | "Down"
  | "Left"
  | "Right";

export const GBA_BUTTONS: GbaButton[] = [
  "A",
  "B",
  "L",
  "R",
  "Start",
  "Select",
  "Up",
  "Down",
  "Left",
  "Right",
];

export type Role = "controller" | "follower";

export interface RosterEntry {
  id: string;
  name: string;
  role: Role;
}

export interface SnapshotMeta {
  frame: number;
  // base64-encoded snapshot bytes (gzip-compressed if compressed=true)
  data: string;
  compressed: boolean;
  // bytes-length of the underlying state file before compression/base64
  rawSize: number;
  // Emulation speed at capture time (SPEC-SPEED §4).
  multiplier: number;
}

// ---- Client → Server ----
//
// JoinMsg now references a persistent SAVE — not an ad-hoc session id.
// The save carries the romId/romHash, so the client does not declare them
// on join; the server tells the client in `welcome` and the client
// hash-checks its local ROM bytes before booting.
export interface JoinMsg {
  type: "join";
  saveId: string;
  name: string;
}

export interface ClientInputMsg {
  type: "input";
  frame: number;
  button: GbaButton;
  pressed: boolean;
}

export interface ClientSnapshotMsg {
  type: "snapshot";
  frame: number;
  data: string;
  compressed: boolean;
  rawSize: number;
  // Speed at which the snapshot was captured. Followers bootstrapping
  // from this snapshot adopt this multiplier so they don't run at the
  // wrong rate after a load (SPEC-SPEED §2).
  multiplier: number;
}

// Controller-emitted speed change. Frame-tagged so followers apply it at
// the same emulated frame (SPEC-SPEED §1).
export interface ClientSpeedMsg {
  type: "speed";
  frame: number;
  multiplier: number;
}

export interface HeartbeatMsg {
  type: "heartbeat";
}

export interface LeaveMsg {
  type: "leave";
}

export type ClientMsg =
  | JoinMsg
  | ClientInputMsg
  | ClientSnapshotMsg
  | ClientSpeedMsg
  | HeartbeatMsg
  | LeaveMsg;

// ---- Server → Client ----
export interface WelcomeMsg {
  type: "welcome";
  selfId: string;
  role: Role;
  controllerId: string | null;
  roster: RosterEntry[];
  latestSnapshot: SnapshotMeta | null;
  // Save context (what game, who has played).
  saveId: string;
  saveName: string;
  romId: string;
  romHash: string;
  contributors: Record<string, number>; // playerName → totalControllerMs
  // Current synchronized emulation speed (SPEC-SPEED §2). New joiners
  // adopt this so they don't run at 1× while the controller is at 4×.
  currentMultiplier: number;
}

export interface RosterMsg {
  type: "roster";
  roster: RosterEntry[];
  controllerId: string | null;
}

export interface ServerInputMsg {
  type: "input";
  frame: number;
  button: GbaButton;
  pressed: boolean;
}

export interface ServerSnapshotMsg {
  type: "snapshot";
  frame: number;
  data: string;
  compressed: boolean;
  rawSize: number;
  // Speed at which the controller captured this snapshot. Followers
  // adopt this multiplier when applying the snapshot.
  multiplier: number;
}

export interface BecomeControllerMsg {
  type: "becomeController";
  frame: number;
  data: string;
  compressed: boolean;
  rawSize: number;
  // The session's current speed (SPEC-SPEED §2). The new controller
  // adopts it after loadState, before resuming.
  multiplier: number;
}

// Relayed from controller to followers.
export interface ServerSpeedMsg {
  type: "speed";
  frame: number;
  multiplier: number;
}

export interface ControllerChangedMsg {
  type: "controllerChanged";
  controllerId: string | null;
}

export interface HeartbeatAckMsg {
  type: "heartbeatAck";
}

// Live contributors update — push when a controller hands over or a snapshot
// flushes accumulated time, so the home-page roster + in-game header can
// reflect the latest minutes-per-player without polling.
export interface ContributorsMsg {
  type: "contributors";
  contributors: Record<string, number>;
}

export interface ErrorMsg {
  type: "error";
  code: string;
  message: string;
}

export type ServerMsg =
  | WelcomeMsg
  | RosterMsg
  | ServerInputMsg
  | ServerSnapshotMsg
  | ServerSpeedMsg
  | BecomeControllerMsg
  | ControllerChangedMsg
  | HeartbeatAckMsg
  | ContributorsMsg
  | ErrorMsg;

// ---- HTTP /api/saves ----
//
// A "save" is the persistent thing: it owns a ROM, a save state on disk, and
// a contributor ledger. The "session" is the in-memory wrapper that exists
// only while at least one player is connected to that save.
export interface SaveSummary {
  id: string;
  name: string;
  romId: string;
  romHash: string;
  romName: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  contributors: Record<string, number>; // playerName → totalControllerMs
  // Live-session info; null when no one is currently in the save.
  live: {
    participantCount: number;
    controllerName: string | null;
  } | null;
}

export interface CreateSaveRequest {
  name: string;
  romId: string;
}

export interface CreateSaveResponse {
  save: SaveSummary;
}

// ---- Tunables (SPEC §17 + SPEC-SPEED §8) ----
export const DEFAULTS = {
  // Wall-clock cadence — kept only as 1×-baseline documentation since
  // M3; SPEC-SPEED makes the primary trigger frame-based.
  SNAPSHOT_INTERVAL_MS: 1500,
  // Floor on wall-clock between snapshots so that at 8× we don't spam
  // the WebSocket (SPEC-SPEED §4).
  MIN_SNAPSHOT_INTERVAL_MS: 300,
  // Primary snapshot trigger — emit at least this many emulated frames
  // since the last snapshot (SPEC-SPEED §4). 90 frames ≈ 1.5 s at 1×.
  SNAPSHOT_INTERVAL_FRAMES: 90,
  FOLLOWER_DELAY_MS: 120,
  HEARTBEAT_INTERVAL_MS: 3000,
  HEARTBEAT_TIMEOUT_MS: 10000,
  RECONCILE_MODE: "hash" as "hash" | "always",
  // If a follower's targetFrame - localFrame exceeds this many frames,
  // it re-anchors (loadState + drop stale scheduled events). SPEC-SPEED §5.
  CATCHUP_THRESHOLD_FRAMES: 180,
} as const;

// Allowed multipliers cycle for the controller's speed button. mGBA's
// `setFastForwardMultiplier` supports arbitrary ≥1 (and negative for
// slow-down). [1, 2, 4, 8] is the user-visible default ladder.
export const SPEED_LADDER: readonly number[] = [1, 2, 4, 8] as const;

export function nextLadderSpeed(current: number): number {
  const i = SPEED_LADDER.indexOf(current);
  if (i < 0) return SPEED_LADDER[0];
  return SPEED_LADDER[(i + 1) % SPEED_LADDER.length];
}

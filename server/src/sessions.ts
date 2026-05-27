// Live session = the in-memory wrapper around a persistent save. A session
// exists only while at least one player is connected to that save. Per SPEC
// §10 the event loop is single-threaded so controller-queue mutations are
// atomic; no locks needed.
//
// Each session tracks `controllerSince` so we can credit wall-time to the
// current controller's contributor entry. The caller (server) calls
// `flushControllerTime()` whenever it persists state (on snapshot, controller
// change, leave) — that returns the delta milliseconds + the controller's
// player name so the SaveStore can update on-disk meta.

import type { RosterEntry, Role, SnapshotMeta } from "@gba/shared";
import { DEFAULTS } from "@gba/shared";

interface Participant {
  connId: string;
  name: string;
  joinedAt: number;
  lastHeartbeat: number;
  role: Role;
}

export interface Session {
  saveId: string;
  participants: Map<string, Participant>;
  controllerQueue: string[]; // FIFO of connIds; head = current controller
  latestSnapshot?: SnapshotMeta & { receivedAt: number };
  // Wall-time accounting for the current controller.
  controllerSince: number; // ms timestamp when current controller took over
  // Synchronized emulation speed (SPEC-SPEED §1). Default 1×; the
  // controller flips this via the `speed` message and the server
  // includes it in welcome / snapshot / becomeController.
  currentMultiplier: number;
}

export interface ContributionDelta {
  playerName: string;
  deltaMs: number;
}

export class SessionStore {
  // saveId → Session
  private sessions = new Map<string, Session>();

  getOrCreate(saveId: string): Session {
    let s = this.sessions.get(saveId);
    if (!s) {
      s = {
        saveId,
        participants: new Map(),
        controllerQueue: [],
        controllerSince: Date.now(),
        currentMultiplier: 1,
      };
      this.sessions.set(saveId, s);
    }
    return s;
  }

  get(saveId: string): Session | undefined {
    return this.sessions.get(saveId);
  }

  delete(saveId: string): void {
    this.sessions.delete(saveId);
  }

  addParticipant(session: Session, connId: string, name: string): { participant: Participant; isController: boolean } {
    session.controllerQueue.push(connId);
    const role: Role = session.controllerQueue[0] === connId ? "controller" : "follower";
    const p: Participant = {
      connId,
      name,
      joinedAt: Date.now(),
      lastHeartbeat: Date.now(),
      role,
    };
    session.participants.set(connId, p);
    if (role === "controller" && session.controllerQueue.length === 1) {
      // First controller in this session → reset the wall-clock origin so we
      // don't pre-credit the empty-session interval to them.
      session.controllerSince = Date.now();
    }
    return { participant: p, isController: role === "controller" };
  }

  // Remove a participant. Returns:
  //   - wasController: true iff this participant was the current controller
  //   - newControllerId: head of the queue after removal (null if empty)
  //   - sessionNowEmpty: true iff no participants remain
  //   - leavingControllerContribution: the wall-time credit accumulated by
  //     this controller's stint, OR null if they weren't the controller.
  removeParticipant(session: Session, connId: string): {
    wasController: boolean;
    newControllerId: string | null;
    sessionNowEmpty: boolean;
    leavingControllerContribution: ContributionDelta | null;
  } {
    const wasController = session.controllerQueue[0] === connId;
    const leavingParticipant = session.participants.get(connId);
    let leavingContribution: ContributionDelta | null = null;
    if (wasController && leavingParticipant) {
      const delta = Date.now() - session.controllerSince;
      leavingContribution = { playerName: leavingParticipant.name, deltaMs: Math.max(0, delta) };
    }

    session.participants.delete(connId);
    const idx = session.controllerQueue.indexOf(connId);
    if (idx >= 0) session.controllerQueue.splice(idx, 1);

    const newControllerId = session.controllerQueue[0] ?? null;
    for (const [id, p] of session.participants) {
      p.role = id === newControllerId ? "controller" : "follower";
    }
    if (wasController) {
      // Reset the origin so the next controller's clock starts now.
      session.controllerSince = Date.now();
    }
    const sessionNowEmpty = session.participants.size === 0;
    if (sessionNowEmpty) this.delete(session.saveId);
    return { wasController, newControllerId, sessionNowEmpty, leavingControllerContribution: leavingContribution };
  }

  setSnapshot(session: Session, snap: SnapshotMeta) {
    session.latestSnapshot = { ...snap, receivedAt: Date.now() };
  }

  touchHeartbeat(session: Session, connId: string) {
    const p = session.participants.get(connId);
    if (p) p.lastHeartbeat = Date.now();
  }

  // Returns the milliseconds the current controller has accumulated since the
  // last flush, AND resets the clock. Caller persists the delta to disk.
  flushControllerTime(session: Session): ContributionDelta | null {
    const ctrlId = session.controllerQueue[0];
    if (!ctrlId) return null;
    const p = session.participants.get(ctrlId);
    if (!p) return null;
    const now = Date.now();
    const delta = now - session.controllerSince;
    session.controllerSince = now;
    if (delta <= 0) return null;
    return { playerName: p.name, deltaMs: delta };
  }

  sweepStale(): { session: Session; staleIds: string[] }[] {
    const out: { session: Session; staleIds: string[] }[] = [];
    const cutoff = Date.now() - DEFAULTS.HEARTBEAT_TIMEOUT_MS;
    for (const session of this.sessions.values()) {
      const staleIds: string[] = [];
      for (const p of session.participants.values()) {
        if (p.lastHeartbeat < cutoff) staleIds.push(p.connId);
      }
      if (staleIds.length > 0) out.push({ session, staleIds });
    }
    return out;
  }

  roster(session: Session): RosterEntry[] {
    return Array.from(session.participants.values()).map((p) => ({
      id: p.connId,
      name: p.name,
      role: p.role,
    }));
  }

  controllerId(session: Session): string | null {
    return session.controllerQueue[0] ?? null;
  }

  controllerName(session: Session): string | null {
    const id = this.controllerId(session);
    if (!id) return null;
    return session.participants.get(id)?.name ?? null;
  }

  isController(session: Session, connId: string): boolean {
    return session.controllerQueue[0] === connId;
  }

  allSessions(): Session[] {
    return Array.from(this.sessions.values());
  }
}

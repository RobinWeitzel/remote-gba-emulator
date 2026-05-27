// Session model + controller queue. In-memory only; sessions die when empty
// (SPEC §10.4). The event loop is single-threaded so the controller queue
// mutations are atomic and we don't need locks.

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
  id: string;
  romId: string;
  romHash: string;
  participants: Map<string, Participant>;
  controllerQueue: string[]; // FIFO of connIds; head = current controller
  latestSnapshot?: SnapshotMeta & { receivedAt: number };
}

export class SessionStore {
  private sessions = new Map<string, Session>();

  // Create-or-get-by-id. The first joiner determines romId/romHash; later
  // joiners must match — caller validates.
  getOrCreate(id: string, romId: string, romHash: string): Session {
    let s = this.sessions.get(id);
    if (!s) {
      s = {
        id,
        romId,
        romHash,
        participants: new Map(),
        controllerQueue: [],
      };
      this.sessions.set(id, s);
    }
    return s;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  delete(id: string): void {
    this.sessions.delete(id);
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
    return { participant: p, isController: role === "controller" };
  }

  // Remove a participant. Returns info about the resulting state change.
  removeParticipant(session: Session, connId: string): {
    wasController: boolean;
    newControllerId: string | null;
    sessionNowEmpty: boolean;
  } {
    const wasController = session.controllerQueue[0] === connId;
    session.participants.delete(connId);
    const idx = session.controllerQueue.indexOf(connId);
    if (idx >= 0) session.controllerQueue.splice(idx, 1);
    const newControllerId = session.controllerQueue[0] ?? null;
    // Update roles
    for (const [id, p] of session.participants) {
      p.role = id === newControllerId ? "controller" : "follower";
    }
    const sessionNowEmpty = session.participants.size === 0;
    if (sessionNowEmpty) this.delete(session.id);
    return { wasController, newControllerId, sessionNowEmpty };
  }

  setSnapshot(session: Session, snap: SnapshotMeta) {
    session.latestSnapshot = { ...snap, receivedAt: Date.now() };
  }

  touchHeartbeat(session: Session, connId: string) {
    const p = session.participants.get(connId);
    if (p) p.lastHeartbeat = Date.now();
  }

  // Sweep stale participants (heartbeat older than HEARTBEAT_TIMEOUT_MS).
  // Returns the list of removed connIds per session.
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

  isController(session: Session, connId: string): boolean {
    return session.controllerQueue[0] === connId;
  }

  allSessions(): Session[] {
    return Array.from(this.sessions.values());
  }
}

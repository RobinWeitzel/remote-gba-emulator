// Milestone 1 acceptance (SPEC-SERVERLESS §14):
//   two devices create/join a session via RTDB; roster syncs; departures
//   detected via onDisconnect; no app-run server involved.
//
// Runs against the Firebase Emulator Suite (auth + database) with OPEN-ish
// rules (auth != null). The capability/security rules are hardened and
// adversarially tested separately in M2 (firebaseRules.itest.ts).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FirebaseAdapter } from "./firebaseAdapter";
import type { FirebaseConfigLike, RosterMember } from "./adapter";

const CFG: FirebaseConfigLike = {
  apiKey: "fake-api-key",
  databaseURL: "https://demo-gba-default-rtdb.firebaseio.com",
  projectId: "demo-gba",
  emulators: {
    auth: "http://127.0.0.1:9099",
    database: { host: "127.0.0.1", port: 9000 },
  },
};
let __dev = 0;

async function clearDb() {
  await fetch("http://127.0.0.1:9000/.json?ns=demo-gba-default-rtdb", { method: "DELETE" });
}

async function newDevice(): Promise<FirebaseAdapter> {
  const a = new FirebaseAdapter();
  await a.init(CFG, String(++__dev));
  await a.signInAnonymously();
  return a;
}

function waitFor<T>(fn: () => T | undefined | null | false, ms = 8000): Promise<T> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let v: any;
      try { v = fn(); } catch (e) { v = undefined; }
      if (v) return resolve(v);
      if (Date.now() - start > ms) return reject(new Error("waitFor timed out"));
      setTimeout(tick, 100);
    };
    tick();
  });
}

describe("FirebaseAdapter — M1 transport", () => {
  beforeEach(clearDb);
  afterEach(clearDb);

  it("creates a session: owner is a member and holds the controller", async () => {
    const owner = await newDevice();
    const { sessionId } = await owner.createSession({ romHash: "abc123", romName: "Test Game", name: "Alice" });
    expect(sessionId).toBeTruthy();
    expect(owner.isOwner()).toBe(true);

    const meta = await owner.getSessionMeta(sessionId);
    expect(meta?.romHash).toBe("abc123");
    expect(meta?.romName).toBe("Test Game");

    let holder: string | null = "unset";
    owner.onControlChanged((h) => { holder = h; });
    await waitFor(() => holder === owner.currentMemberId());
    expect(holder).toBe(owner.currentMemberId());
  });

  it("a second device redeems an invite and joins; roster syncs to both", async () => {
    const owner = await newDevice();
    const { sessionId } = await owner.createSession({ romHash: "h", romName: "G", name: "Alice" });

    let ownerRoster: RosterMember[] = [];
    owner.onRoster((m) => { ownerRoster = m; });

    const invite = await owner.mintInvite();
    expect(invite.sessionId).toBe(sessionId);

    const guest = await newDevice();
    const res = await guest.joinViaInvite(invite, { name: "Bob" });
    expect(res.sessionId).toBe(sessionId);
    expect(res.memberId).toBe(guest.currentMemberId());

    // Both devices' rosters converge to 2 named members.
    const roster = await waitFor(() => (ownerRoster.length === 2 ? ownerRoster : null));
    const names = roster.map((m) => m.name).sort();
    expect(names).toEqual(["Alice", "Bob"]);

    let guestRoster: RosterMember[] = [];
    guest.onRoster((m) => { guestRoster = m; });
    await waitFor(() => (guestRoster.length === 2 ? guestRoster : null));
    expect(guestRoster.map((m) => m.name).sort()).toEqual(["Alice", "Bob"]);
  });

  it("rejects a second redemption of the same single-use invite", async () => {
    const owner = await newDevice();
    await owner.createSession({ romHash: "h", romName: "G", name: "Alice" });
    const invite = await owner.mintInvite();

    const g1 = await newDevice();
    await g1.joinViaInvite(invite, { name: "Bob" });

    const g2 = await newDevice();
    await expect(g2.joinViaInvite(invite, { name: "Carol" })).rejects.toThrow(/already been used/i);
  });

  it("reconnect uses the stored credential and needs no fresh invite", async () => {
    const owner = await newDevice();
    const { sessionId } = await owner.createSession({ romHash: "h", romName: "G", name: "Alice" });
    const invite = await owner.mintInvite();
    const guest = await newDevice();
    await guest.joinViaInvite(invite, { name: "Bob" });
    await guest.leaveSession();

    // Same adapter instance (same uid) reconnects without an invite.
    await expect(guest.reconnect(sessionId, { name: "Bob" })).resolves.toBeUndefined();
  });

  it("detects an ungraceful drop via onDisconnect (presence + control released)", async () => {
    const owner = await newDevice();
    const { sessionId } = await owner.createSession({ romHash: "h", romName: "G", name: "Alice" });
    const invite = await owner.mintInvite();
    const guest = await newDevice();
    await guest.joinViaInvite(invite, { name: "Bob" });

    // Guest grabs the controller (owner held it; release first to free it).
    await owner.releaseControl();
    const got = await guest.claimControl();
    expect(got).toBe(true);

    let holder: string | null = "unset";
    owner.onControlChanged((h) => { holder = h; });
    await waitFor(() => holder === guest.currentMemberId());

    let ownerRoster: RosterMember[] = [];
    owner.onRoster((m) => { ownerRoster = m; });
    await waitFor(() => ownerRoster.find((m) => m.id === guest.currentMemberId())?.online === true);

    // Ungraceful drop: socket dies. The server runs the guest's onDisconnect:
    // clears lastSeen (→ offline) and releases the controller lock (→ null).
    await guest.__simulateDropForTest();

    await waitFor(() => holder === null, 10000);
    expect(holder).toBe(null);

    const guestEntry = await waitFor(() => {
      const e = ownerRoster.find((m) => m.id === guest.currentMemberId());
      return e && e.online === false ? e : null;
    }, 10000);
    expect(guestEntry.online).toBe(false);
  });
});

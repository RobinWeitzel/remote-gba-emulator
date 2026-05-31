// Milestone 3 — sync-relay correctness over RTDB (SPEC-SERVERLESS §11).
//
// Proves the adapter carries the EXISTING relay payloads (input / speed /
// snapshot) unchanged from controller to follower, mirrors speed for late
// joiners, and that controller handoff (graceful) re-points who may publish.
// The actual frame-accurate reconciliation is the unchanged SessionPage logic;
// here we verify the transport it sits on. Runs under the locked rules.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { get } from "firebase/database";
import { FirebaseAdapter } from "./firebaseAdapter";
import type { FirebaseConfigLike, InputMsg, SnapshotMsg, SpeedMsg } from "./adapter";

const CFG: FirebaseConfigLike = {
  apiKey: "fake-api-key",
  databaseURL: "https://demo-gba-default-rtdb.firebaseio.com",
  projectId: "demo-gba",
  emulators: { auth: "http://127.0.0.1:9099", database: { host: "127.0.0.1", port: 9000 } },
};
let __dev = 0;

async function clearDb() {
  await fetch("http://127.0.0.1:9000/.json?ns=demo-gba-default-rtdb", { method: "DELETE" });
}
async function device(): Promise<FirebaseAdapter> {
  const a = new FirebaseAdapter();
  await a.init(CFG, String(++__dev));
  await a.signInAnonymously();
  return a;
}
function waitFor<T>(fn: () => T | undefined | null | false, ms = 8000): Promise<T> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let v: any; try { v = fn(); } catch { v = undefined; }
      if (v) return resolve(v);
      if (Date.now() - start > ms) return reject(new Error("waitFor timed out"));
      setTimeout(tick, 50);
    };
    tick();
  });
}
async function pair(): Promise<{ owner: FirebaseAdapter; guest: FirebaseAdapter; sessionId: string }> {
  const owner = await device();
  const { sessionId } = await owner.createSession({ romHash: "h", romName: "G", name: "Alice" });
  const invite = await owner.mintInvite();
  const guest = await device();
  await guest.joinViaInvite(invite, { name: "Bob" });
  return { owner, guest, sessionId };
}

describe("Sync relay over RTDB (§11)", () => {
  beforeEach(clearDb);
  afterEach(clearDb);

  it("controller inputs fan out to the follower with author tag", async () => {
    const { owner, guest } = await pair();
    const got: InputMsg[] = [];
    guest.onInput((m) => got.push(m));
    await new Promise((r) => setTimeout(r, 200)); // ensure listener armed
    owner.sendInput({ frame: 10, button: "A", pressed: true });
    owner.sendInput({ frame: 12, button: "A", pressed: false });
    const msgs = await waitFor(() => (got.length >= 2 ? got : null));
    expect(msgs[0]).toMatchObject({ frame: 10, button: "A", pressed: true, by: owner.currentMemberId() });
    expect(msgs[1]).toMatchObject({ frame: 12, button: "A", pressed: false });
  });

  it("speed events fan out and meta speed mirrors for late joiners", async () => {
    const { owner, guest, sessionId } = await pair();
    const got: SpeedMsg[] = [];
    guest.onSpeed((m) => got.push(m));
    await new Promise((r) => setTimeout(r, 200));
    owner.sendSpeed({ frame: 50, multiplier: 4 });
    owner.publishSpeedMeta(4);
    const msgs = await waitFor(() => (got.length >= 1 ? got : null));
    expect(msgs[0]).toMatchObject({ frame: 50, multiplier: 4, by: owner.currentMemberId() });
    const metaSpeed = await get(owner.__rawRef(`sessions/${sessionId}/meta/speedMultiplier`));
    expect(metaSpeed.val()).toBe(4);
  });

  it("snapshot publishes overwrite the single latest and reach the follower", async () => {
    const { owner, guest, sessionId } = await pair();
    let latest: SnapshotMsg | null = null;
    guest.onSnapshot((m) => { latest = m; });
    await owner.publishSnapshot({ frame: 90, data: "AAAA", compressed: false, rawSize: 3, multiplier: 1 });
    await owner.publishSnapshot({ frame: 180, data: "BBBB", compressed: false, rawSize: 3, multiplier: 2 });
    const got = await waitFor(() => (latest && (latest as SnapshotMsg).frame === 180 ? latest : null));
    expect(got).toMatchObject({ frame: 180, data: "BBBB", multiplier: 2, by: owner.currentMemberId() });
    // Only the latest is stored (overwrite, not append) — bounds egress (§12).
    const snap = await get(owner.__rawRef(`sessions/${sessionId}/sync/snapshot`));
    expect(snap.val().frame).toBe(180);
  });

  it("graceful handoff: after release+claim the NEW controller may publish and the old one receives", async () => {
    const { owner, guest } = await pair();
    // Owner held control from creation; hand off to guest.
    await owner.releaseControl();
    expect(await guest.claimControl()).toBe(true);

    // Old controller (owner) now follows and receives the new controller's snapshot.
    let received: SnapshotMsg | null = null;
    owner.onSnapshot((m) => { received = m; });
    await guest.publishSnapshot({ frame: 200, data: "CCCC", compressed: false, rawSize: 3, multiplier: 1 });
    const got = await waitFor(() => (received && (received as SnapshotMsg).frame === 200 ? received : null));
    expect(got).toMatchObject({ frame: 200, by: guest.currentMemberId() });
  });
});

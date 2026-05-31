// Milestone 2 — adversarial security-rules tests (SPEC-SERVERLESS §6, §15).
//
// These run against the Firebase Emulator with the REAL locked rules
// (database.rules.json). They assert that legitimate flows succeed AND that
// every abuse path a public attacker could attempt is rejected with
// PERMISSION_DENIED. A gap here = a publicly abusable app, so this is the most
// important test file in the project.
//
// Legit setup uses the adapter (the real protocol). Adversarial probes use raw
// SDK ops (set/get/runTransaction) via adapter.__rawRef(absPath), which runs as
// that adapter's authenticated identity.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { get, set, runTransaction } from "firebase/database";
import { FirebaseAdapter } from "./firebaseAdapter";
import type { FirebaseConfigLike } from "./adapter";

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
async function device(): Promise<FirebaseAdapter> {
  const a = new FirebaseAdapter();
  await a.init(CFG, String(++__dev));
  await a.signInAnonymously();
  return a;
}
async function denied(p: Promise<unknown>): Promise<void> {
  await expect(p).rejects.toThrow(/PERMISSION_DENIED|permission_denied|Permission denied/i);
}
async function allowed(p: Promise<unknown>): Promise<void> {
  await expect(p).resolves.not.toThrow();
}
const P = (sid: string, sub: string) => `sessions/${sid}/${sub}`;

describe("Security rules — capability model (§6)", () => {
  beforeEach(clearDb);
  afterEach(clearDb);

  it("legit happy path: owner creates, mints, guest redeems & becomes member", async () => {
    const owner = await device();
    const { sessionId } = await owner.createSession({ romHash: "hashX", romName: "Game", name: "Alice" });
    const invite = await owner.mintInvite();
    const guest = await device();
    await allowed(guest.joinViaInvite(invite, { name: "Bob" }));
    // Member can read session sync; meta is readable pre-join (auth).
    await allowed(get(guest.__rawRef(P(sessionId, "sync"))));
  });

  it("a non-owner cannot mint an invite", async () => {
    const owner = await device();
    const { sessionId } = await owner.createSession({ romHash: "h", romName: "G", name: "Alice" });
    const invite = await owner.mintInvite();
    const guest = await device();
    await guest.joinViaInvite(invite, { name: "Bob" });
    // Bob is a member but NOT an owner — minting must be denied.
    await denied(set(guest.__rawRef(P(sessionId, "invites/forged1")), { createdBy: guest.currentMemberId(), createdAt: 1 }));
  });

  it("an invite is single-use at the RULES level (not just the adapter)", async () => {
    const owner = await device();
    const { sessionId } = await owner.createSession({ romHash: "h", romName: "G", name: "Alice" });
    const invite = await owner.mintInvite();
    const g1 = await device();
    await g1.joinViaInvite(invite, { name: "Bob" });
    // Raw second redemption of the same invite → rules reject (redeemedBy set).
    const g2 = await device();
    await denied(
      runTransaction(g2.__rawRef(P(sessionId, `invites/${invite.inviteId}/redeemedBy`)), () => g2.currentMemberId()),
    );
  });

  it("you cannot redeem an invite to someone else's uid", async () => {
    const owner = await device();
    const { sessionId } = await owner.createSession({ romHash: "h", romName: "G", name: "Alice" });
    const invite = await owner.mintInvite();
    const attacker = await device();
    // Try to set redeemedBy to the OWNER's uid (not the attacker's) → denied.
    await denied(set(attacker.__rawRef(P(sessionId, `invites/${invite.inviteId}/redeemedBy`)), owner.currentMemberId()));
  });

  it("you cannot become a member without a redeemed invite", async () => {
    const owner = await device();
    const { sessionId } = await owner.createSession({ romHash: "h", romName: "G", name: "Alice" });
    const invite = await owner.mintInvite(); // minted but NOT redeemed by attacker
    const attacker = await device();
    const uid = attacker.currentMemberId()!;
    // viaInvite points at a real-but-unredeemed-by-me invite → denied.
    await denied(set(attacker.__rawRef(P(sessionId, `members/${uid}`)), { name: "Mallory", viaInvite: invite.inviteId }));
    // No invite at all → denied.
    await denied(set(attacker.__rawRef(P(sessionId, `members/${uid}`)), { name: "Mallory", viaInvite: "nope" }));
  });

  it("a non-member cannot read members / sync / saves / controllerLock", async () => {
    const owner = await device();
    const { sessionId } = await owner.createSession({ romHash: "h", romName: "G", name: "Alice" });
    const outsider = await device();
    await denied(get(outsider.__rawRef(P(sessionId, "members"))));
    await denied(get(outsider.__rawRef(P(sessionId, "sync"))));
    await denied(get(outsider.__rawRef(P(sessionId, "saves"))));
    await denied(get(outsider.__rawRef(P(sessionId, "controllerLock"))));
  });

  it("a non-member cannot write sync or saves", async () => {
    const owner = await device();
    const { sessionId } = await owner.createSession({ romHash: "h", romName: "G", name: "Alice" });
    const outsider = await device();
    const uid = outsider.currentMemberId();
    await denied(set(outsider.__rawRef(P(sessionId, "sync/snapshot")), { frame: 1, data: "x", by: uid }));
    await denied(set(outsider.__rawRef(P(sessionId, "saves/latest")), { data: "x", frame: 1, at: 1, by: uid }));
  });

  it("a member who is NOT the controller cannot write inputs/speed/snapshot/speedMultiplier", async () => {
    const owner = await device(); // owner holds the controller after createSession
    const { sessionId } = await owner.createSession({ romHash: "h", romName: "G", name: "Alice" });
    const invite = await owner.mintInvite();
    const guest = await device();
    await guest.joinViaInvite(invite, { name: "Bob" });
    const uid = guest.currentMemberId();
    await denied(set(guest.__rawRef(P(sessionId, "sync/inputs/x")), { frame: 1, button: "A", pressed: true, by: uid }));
    await denied(set(guest.__rawRef(P(sessionId, "sync/speed/x")), { frame: 1, multiplier: 4, by: uid }));
    await denied(set(guest.__rawRef(P(sessionId, "sync/snapshot")), { frame: 1, data: "x", by: uid }));
    await denied(set(guest.__rawRef(P(sessionId, "meta/speedMultiplier")), 4));
  });

  it("a member can claim a FREE lock but cannot STEAL or NULL a held one", async () => {
    const owner = await device();
    const { sessionId } = await owner.createSession({ romHash: "h", romName: "G", name: "Alice" });
    const invite = await owner.mintInvite();
    const guest = await device();
    await guest.joinViaInvite(invite, { name: "Bob" });
    const gUid = guest.currentMemberId();

    // Owner currently holds it. Guest cannot steal (set to self) or null it.
    await denied(set(guest.__rawRef(P(sessionId, "controllerLock/holder")), gUid));
    await denied(set(guest.__rawRef(P(sessionId, "controllerLock/holder")), null));

    // Owner releases → lock free → guest CAN claim it.
    await owner.releaseControl();
    expect(await guest.claimControl()).toBe(true);
  });

  it("only the owner can revoke a member; a non-owner cannot delete others", async () => {
    const owner = await device();
    const { sessionId } = await owner.createSession({ romHash: "h", romName: "G", name: "Alice" });
    const i1 = await owner.mintInvite();
    const bob = await device();
    await bob.joinViaInvite(i1, { name: "Bob" });
    const i2 = await owner.mintInvite();
    const carol = await device();
    await carol.joinViaInvite(i2, { name: "Carol" });
    const bobUid = bob.currentMemberId();

    // Carol (non-owner) cannot delete Bob.
    await denied(set(carol.__rawRef(P(sessionId, `members/${bobUid}`)), null));
    // Owner CAN revoke Bob.
    await allowed(set(owner.__rawRef(P(sessionId, `members/${bobUid}`)), null));
  });

  it("a non-owner member cannot overwrite session meta (romHash); the owner can", async () => {
    const owner = await device();
    const { sessionId } = await owner.createSession({ romHash: "orig", romName: "G", name: "Alice" });
    const invite = await owner.mintInvite();
    const guest = await device();
    await guest.joinViaInvite(invite, { name: "Bob" });
    await denied(set(guest.__rawRef(P(sessionId, "meta/romHash")), "tampered"));
    await allowed(set(owner.__rawRef(P(sessionId, "meta/romHash")), "ownerchange"));
  });
});

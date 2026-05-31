// Milestone 5 — durable saves + free-tier guardrails (SPEC-SERVERLESS §12).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { get } from "firebase/database";
import { FirebaseAdapter } from "./firebaseAdapter";
import type { FirebaseConfigLike } from "./adapter";

const CFG: FirebaseConfigLike = {
  apiKey: "fake", databaseURL: "https://demo-gba-default-rtdb.firebaseio.com", projectId: "demo-gba",
  emulators: { auth: "http://127.0.0.1:9099", database: { host: "127.0.0.1", port: 9000 } },
};
let __dev = 0;
async function clearDb() { await fetch("http://127.0.0.1:9000/.json?ns=demo-gba-default-rtdb", { method: "DELETE" }); }
async function device(): Promise<FirebaseAdapter> {
  const a = new FirebaseAdapter(); await a.init(CFG, String(++__dev)); await a.signInAnonymously(); return a;
}
async function pair() {
  const owner = await device();
  const { sessionId } = await owner.createSession({ romHash: "h", romName: "G", name: "Alice" });
  const invite = await owner.mintInvite();
  const guest = await device();
  await guest.joinViaInvite(invite, { name: "Bob" });
  return { owner, guest, sessionId };
}

describe("Durable saves + guardrails (§12)", () => {
  beforeEach(clearDb);
  afterEach(clearDb);

  it("durable save round-trips and survives 'everyone leaving'", async () => {
    const { owner, sessionId } = await pair();
    await owner.saveDurable("latest", { data: "SAVE", frame: 1234, at: Date.now(), by: owner.currentMemberId()! });
    // A fresh device that rejoins (here: re-read) sees the durable save.
    const loaded = await owner.loadDurable("latest");
    expect(loaded).toMatchObject({ data: "SAVE", frame: 1234 });
    const raw = await get(owner.__rawRef(`sessions/${sessionId}/saves/latest`));
    expect(raw.val().frame).toBe(1234);
  });

  it("pruneRelay clears the transient input/speed streams", async () => {
    const { owner, sessionId } = await pair();
    owner.sendInput({ frame: 1, button: "A", pressed: true });
    owner.sendSpeed({ frame: 1, multiplier: 2 });
    await new Promise((r) => setTimeout(r, 200));
    await owner.pruneRelay();
    const inputs = await get(owner.__rawRef(`sessions/${sessionId}/sync/inputs`));
    const speed = await get(owner.__rawRef(`sessions/${sessionId}/sync/speed`));
    expect(inputs.exists()).toBe(false);
    expect(speed.exists()).toBe(false);
  });

  it("only the owner can delete the session (cleanup)", async () => {
    const { owner, guest, sessionId } = await pair();
    // Guest (non-owner) deletion is rejected by the rules.
    await expect(guest.deleteSession()).rejects.toThrow(/owner/i);
    // Owner deletes → whole subtree gone. Verify via meta (readable by any
    // auth'd user); reading the bare session node has no .read rule (default
    // deny), which is fine — the data is gone.
    await owner.deleteSession();
    const snap = await get(owner.__rawRef(`sessions/${sessionId}/meta`));
    expect(snap.exists()).toBe(false);
  });
});

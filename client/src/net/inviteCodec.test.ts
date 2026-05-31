import { describe, it, expect } from "vitest";
import { encodeInvite, decodeInvite } from "./inviteCodec";
import type { FirebaseConfigLike } from "./adapter";

const cfg: FirebaseConfigLike = {
  apiKey: "AIzaSyDVaufYhRaE6XiogBLgQSnxRirzSU9N79s",
  authDomain: "play-together-gba.firebaseapp.com",
  databaseURL: "https://play-together-gba-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "play-together-gba",
  appId: "1:123:web:abc",
};

describe("inviteCodec", () => {
  it("round-trips an invite payload (config + session + invite) through a URL-safe blob", () => {
    const blob = encodeInvite({ config: cfg, sessionId: "-Otz123", inviteId: "-Inv456", romName: "Pokemon Emerald" });
    // URL-safe: no +, /, or = padding.
    expect(blob).not.toMatch(/[+/=]/);
    const back = decodeInvite(blob);
    expect(back.sessionId).toBe("-Otz123");
    expect(back.inviteId).toBe("-Inv456");
    expect(back.romName).toBe("Pokemon Emerald");
    expect(back.config.databaseURL).toBe(cfg.databaseURL);
    expect(back.config.projectId).toBe("play-together-gba");
    expect(back.config.apiKey).toBe(cfg.apiKey);
  });

  it("rejects a malformed blob", () => {
    expect(() => decodeInvite("not-valid-base64-$$$")).toThrow();
    expect(() => decodeInvite(encodeInvite({ config: cfg, sessionId: "", inviteId: "x" }).slice(0, 4))).toThrow();
  });
});

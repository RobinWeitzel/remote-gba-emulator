import { describe, it, expect } from "vitest";
import { parseConfigText } from "./config";

describe("parseConfigText — tolerant Firebase config parsing", () => {
  it("parses strict JSON", () => {
    const cfg = parseConfigText('{ "apiKey": "k", "databaseURL": "https://x.firebaseio.com", "projectId": "p" }');
    expect(cfg.apiKey).toBe("k");
    expect(cfg.databaseURL).toBe("https://x.firebaseio.com");
  });

  it("parses the Firebase console JS object (unquoted keys, https in values)", () => {
    const pasted = `{
      apiKey: "AIzaSyDVaufYhRaE6XiogBLgQSnxRirzSU9N79s",
      authDomain: "play-together-gba.firebaseapp.com",
      databaseURL: "https://play-together-gba-default-rtdb.europe-west1.firebasedatabase.app",
      projectId: "play-together-gba",
      storageBucket: "play-together-gba.firebasestorage.app",
      messagingSenderId: 1234567890,
      appId: "1:1234567890:web:abcdef"
    }`;
    const cfg = parseConfigText(pasted);
    expect(cfg.apiKey).toBe("AIzaSyDVaufYhRaE6XiogBLgQSnxRirzSU9N79s");
    // The https:// in the value must survive intact (not get a key quote).
    expect(cfg.databaseURL).toBe("https://play-together-gba-default-rtdb.europe-west1.firebasedatabase.app");
    expect(cfg.projectId).toBe("play-together-gba");
    expect(cfg.appId).toBe("1:1234567890:web:abcdef");
  });

  it("tolerates the `const firebaseConfig = {…};` wrapper and trailing commas", () => {
    const pasted = `const firebaseConfig = {
      apiKey: "k",
      databaseURL: "https://x.firebaseio.com",
      projectId: "p",
    };`;
    const cfg = parseConfigText(pasted);
    expect(cfg.apiKey).toBe("k");
    expect(cfg.projectId).toBe("p");
  });
});

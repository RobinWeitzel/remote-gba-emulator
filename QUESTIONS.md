# QUESTIONS / BLOCKERS for the human

Only hard blockers or things genuinely requiring the human go here. Empty = no blockers.

## Open

### Q1 — Real Android-device verification of Milestone 0 (NOT a blocker)
M0's acceptance includes "emulator runs on a **real Android device**." I cannot hold a phone, so I verified cross-origin isolation + `SharedArrayBuffer` + threaded-mGBA boot **on the actual live deployed URL** using desktop Chromium via Playwright (identical COOP/COEP service-worker path). All green.

**Please confirm on your Android phone (2 min):** open
**https://robinweitzel.de/play-together-gba/#/m0**
You should see `crossOriginIsolated: true`, `SharedArrayBuffer: available`, and after you pick any `.gba` ROM the frame counter should climb. If it does NOT isolate on Android specifically, tell me and I'll switch to the single-threaded mGBA fallback. (Not blocking — the path is desktop-verified and the fallback is documented.)

# QUESTIONS / BLOCKERS for the human

Only hard blockers or things genuinely requiring the human go here. Empty = no blockers.

## ⚠️ Config model changed (re-read) — config is NO LONGER baked into the deploy
The previous build baked your Firebase config into the public site, which let any
visitor consume your free quota. Fixed: **config is now entered in-app and travels
inside invite links.**
- **You can delete the `FIREBASE_CONFIG` repo variable** — it's unused now.
- After deploying the new build, on the site go to **Hosting → Add your Firebase
  config** and paste your `firebaseConfig`. Then *Start a new game* and *Create
  invite link* — the link carries your config so invitees just open it.
- Random visitors to your URL now see only an empty lobby + "add config" — they
  cannot touch your project.
- **Reload Permission-denied is fixed** (anonymous identity is now stable per
  project across reloads).

## To go fully live — YOUR one-time actions (not blockers for the build)
The re-platforming is complete and deployed. The deployed app currently shows
"add your Firebase config" because only you can create the (free) Firebase
project. Follow **README → "1. Firebase setup"** then **"2. Deploy"**, in short:
1. Create a free **Spark** Firebase project; enable **Realtime Database** + **Anonymous Auth**.
2. Publish `database.rules.json` (paste in console, or `firebase deploy --only database`).
3. Add a repo **Actions variable `FIREBASE_CONFIG`** with your web-config JSON (it isn't a secret), then **re-run the deploy from the UI** (repo *Actions → "Deploy static PWA to GitHub Pages" → Run workflow*) — no commit needed; the variable is read at build time.
4. Open the site on Android and run the full flow (see Q1).
The code path is fully verified against the Firebase emulator (49 tests) and via
a live browser-owner + second-device E2E; only your own project + config remain.

## Open

### Q1 — Real Android-device verification of Milestone 0 (NOT a blocker)
M0's acceptance includes "emulator runs on a **real Android device**." I cannot hold a phone, so I verified cross-origin isolation + `SharedArrayBuffer` + threaded-mGBA boot **on the actual live deployed URL** using desktop Chromium via Playwright (identical COOP/COEP service-worker path). All green.

**Please confirm on your Android phone (2 min):** open
**https://robinweitzel.de/play-together-gba/#/m0**
You should see `crossOriginIsolated: true`, `SharedArrayBuffer: available`, and after you pick any `.gba` ROM the frame counter should climb. If it does NOT isolate on Android specifically, tell me and I'll switch to the single-threaded mGBA fallback. (Not blocking — the path is desktop-verified and the fallback is documented.)

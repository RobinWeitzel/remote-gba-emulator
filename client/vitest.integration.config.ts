// Integration tests (*.itest.ts) that exercise the Firebase adapter against the
// local Firebase Emulator Suite. Run via:
//   firebase emulators:exec --project demo-gba --only auth,database \
//     "npm --workspace client run test:itest"
// (see root package.json `test:itest`). Node environment — no jsdom — because
// these simulate real devices talking to RTDB, not React components.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@gba/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.itest.ts"],
    // The emulator can be slow to accept the first connection.
    testTimeout: 20000,
    hookTimeout: 20000,
    // Run serially — tests share the emulator and clear the DB between them.
    fileParallelism: false,
  },
});
